/**
 * jobs-filter-node.ts — node for the JOB-SEARCH graph.
 *
 * De-duplicates against already-sent job IDs from DB, applies user's
 * excluded-skills preference, then calls the LLM filter agent to remove
 * hard-blocker jobs. Returns filteredPositions.
 *
 * Used in: graphs/job-search-graph.ts (jobsSearch -> jobsFilter -> matcher|retry)
 */

import {
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  createAgent,
  toolStrategy,
} from 'langchain';
import { getSentJobIds, getUser, getUserPreferences } from '../../db';
import { makeJobsFilterModel } from '../models';
import { FilterResult, type JobSearchStateType } from '../schemas';

// -- System prompt --

const FILTER_PROMPT = [
  'You are a job filter agent. Your job is to REMOVE only obviously bad fits. Be PERMISSIVE.',
  '',
  'REMOVE a job only if it has ANY of the following hard blockers:',
  '- Requires US security clearance (Secret, TS/SCI, polygraph)',
  '- Mandatory technology the candidate definitely lacks (e.g. job REQUIRES Python-only and candidate has no Python at all)',
  '- Mandatory degree the candidate does not have (e.g. "Master\'s required", "PhD required")',
  '- Requires 10+ years in a very specific narrow domain the candidate has zero experience in',
  '- Clearly wrong domain (embedded C firmware, iOS-only, Android-only, data science, pure frontend)',
  '',
  'DO NOT REMOVE:',
  '- Jobs in US or elsewhere onsite -- the matcher will handle location concerns',
  '- Jobs where candidate is slightly underqualified (e.g. 8 years required, candidate has 7)',
  "- Jobs asking for skills adjacent to candidate's (e.g. Python when candidate has TypeScript)",
  '- Jobs with vague requirements',
  '- Freelance/contractor/remote jobs even if they seem informal',
  '',
  'Respect the output format.',
  '- filtered: jobs that passed (keep)',
  '- excluded: jobs removed, each with a short reason (1 sentence)',
].join('\n');

// -- Node --

export const jobsFilterNode = async (
  state: JobSearchStateType
): Promise<Partial<JobSearchStateType>> => {
  const { telegramUserId, openrouterKey } = state;
  const user = getUser(telegramUserId);

  // 1. De-dup against already-sent
  const sentIds = new Set(getSentJobIds(user?.id ?? 0));
  const alreadySent = state.foundPositions.filter(p => sentIds.has(p.jobId));
  const freshPositions = state.foundPositions.filter(p => !sentIds.has(p.jobId));
  console.log(
    `Before filtering: ${state.foundPositions.length} total -> ${alreadySent.length} already sent -> ${freshPositions.length} fresh`
  );

  // 2. Build messages
  const messages: BaseMessage[] = [];
  const prefs = getUserPreferences(telegramUserId);
  if (prefs.excludedSkills?.length) {
    messages.push(
      new SystemMessage(
        `Also EXCLUDE jobs that REQUIRE these skills (user explicitly doesn't want them): ${prefs.excludedSkills.join(', ')}`
      )
    );
  }
  if (alreadySent.length > 0) {
    messages.push(
      new SystemMessage(
        'You already sent these jobs to the user. Skip them: ' + JSON.stringify(alreadySent)
      )
    );
  }
  messages.push(
    new HumanMessage(JSON.stringify({ profile: state.profile, positions: freshPositions }))
  );

  // 3. Call filter agent
  const agent = createAgent({
    model: makeJobsFilterModel({ apiKey: openrouterKey }),
    responseFormat: toolStrategy(FilterResult),
    systemPrompt: FILTER_PROMPT,
  });
  const result = await agent.invoke({ messages });
  const filterResult: { filtered?: any[]; excluded?: any[] } = result.structuredResponse ?? {
    filtered: [],
    excluded: [],
  };

  const filtered = filterResult.filtered ?? [];
  const excluded = filterResult.excluded ?? [];

  console.log(`Kept: ${filtered.length} | Excluded: ${excluded.length}`);
  if (excluded.length > 0) {
    excluded.forEach((e: any) => console.log(`   x ${e.posting?.title ?? '?'} -- ${e.reason}`));
  }

  return { messages, filteredPositions: filtered };
};
