/**
 * jobs-search-node.ts — node for the JOB-SEARCH graph.
 *
 * Takes the candidate profile + already-found positions from state, asks the
 * LLM to plan 3-4 diverse search queries, executes them in parallel against
 * the JSearch MCP tool, returns de-duplicated JobPosting[].
 *
 * NOTE: The MCP client is initialised once per graph build and the searchTool
 * is injected via makeJobsSearchNode closure. This is the one factory in the
 * codebase — kept because MCP init is expensive and must not repeat per-node.
 *
 * Used in: graphs/job-search-graph.ts (profileExtractor → jobsSearch → jobsFilter)
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import { type BaseMessage, HumanMessage, SystemMessage, createAgent } from 'langchain';
import { getUser, getUserInsights, getUserPreferences } from '../../db';
import { makeJobsSearchModel } from '../models';
import {
  type JobPostingType,
  type JobSearchStateType,
  SearchQuery,
  type SearchResultRawJobType,
} from '../schemas';

// ── System prompt ─────────────────────────────────────────

const QUERY_PLANNER_PROMPT = `You are a job search query planner.
Generate 3-4 DIVERSE, BROAD search queries to find as many relevant job postings as possible.

RULES:
- NEVER add location constraints (no country, city, remote/onsite). The search engine defaults to US which is fine.
- NEVER add experience level, salary, or education constraints in the query string.
- Use a MIX of: role title queries AND skill-based queries.
- If already-found jobs are provided, generate queries that find DIFFERENT positions (different companies, different role angles).
- ALWAYS RESPECT RESPONSE FORMAT.

Good query examples: "LangGraph engineer", "MCP platform developer", "AI infrastructure engineer", "agentic systems TypeScript"
Bad query examples: "Remote LangGraph engineer Israel 5 years", "Senior AI Engineer Python only"`;

// ── Helpers ───────────────────────────────────────────────

function mapRawJob(job: SearchResultRawJobType & Record<string, any>): JobPostingType {
  return {
    jobId: job.job_id,
    title: job.job_title,
    company: job.employer_name ?? 'Unknown',
    applyUrl: job.job_apply_link ?? job.job_google_link ?? '',
    requiredSkills: job.job_required_skills ?? [],
    minExperience: Math.round(
      (job.job_required_experience?.required_experience_in_months ?? 0) / 12
    ),
    locations: [
      {
        address: job.job_city ?? job.job_state ?? job.job_country ?? undefined,
        addressKind: job.job_country ? ('country' as const) : ('global' as const),
        workType: job.job_is_remote ? ('remote' as const) : ('onsite' as const),
      },
    ],
  };
}

// ── Node factory (only because MCP tool injection) ────────

export function makeJobsSearchNode(searchTool: StructuredToolInterface) {
  const jobsSearchNode = async (
    state: JobSearchStateType
  ): Promise<Partial<JobSearchStateType>> => {
    const { telegramUserId, openrouterKey } = state;
    const user = getUser(telegramUserId);
    const round = (state.searchRound ?? 0) + 1;
    console.log(`\n🔍 Search round ${round}... (found so far: ${state.foundPositions.length})`);

    // Build messages
    const messages: BaseMessage[] = [
      new HumanMessage(
        `Candidate profile:\n${JSON.stringify(state.profile, null, 2)}\n\nAlready found job titles (do NOT repeat these):\n${JSON.stringify(
          state.foundPositions.map(p => p.title),
          null,
          2
        )}`
      ),
    ];

    const insights = getUserInsights(user?.id ?? 0);
    const prefs = getUserPreferences(telegramUserId);
    if (insights.length > 0) {
      messages.push(
        new SystemMessage(
          `User job-search insights (use to prioritise / de-prioritise):\n${insights.map(i => `- ${i}`).join('\n')}`
        )
      );
    }
    if (prefs.preferredRoles?.length) {
      messages.push(new SystemMessage(`Preferred roles: ${prefs.preferredRoles.join(', ')}`));
    }
    if (prefs.remoteOnly) {
      messages.push(
        new SystemMessage(
          'User wants remote jobs only — include work_from_home:true in ALL queries'
        )
      );
    }

    // Plan queries
    const queryAgent = createAgent({
      model: makeJobsSearchModel({ apiKey: openrouterKey }),
      systemPrompt: QUERY_PLANNER_PROMPT,
      responseFormat: (await import('zod')).z.array(SearchQuery),
    });
    const queriesResult = await queryAgent.invoke({ messages });
    const queries = queriesResult.structuredResponse ?? [];
    console.log(
      `🔍 Planned queries:`,
      queries.map((q: any) => q.query)
    );

    if (queries.length === 0) {
      console.warn('⚠️  Query planner returned empty list');
      return { messages: [], foundPositions: [], searchRound: round };
    }

    // Execute all queries in parallel
    const rawResponses = await Promise.all(queries.map((q: any) => searchTool.invoke(q)));

    // Parse + flatten + dedup
    const allRaw: (SearchResultRawJobType & Record<string, any>)[] = rawResponses.flatMap(
      (response: any) => {
        const parsed = JSON.parse(
          typeof response === 'string' ? response : JSON.stringify(response)
        );
        return parsed.data ?? [];
      }
    );
    const unique = [...new Map(allRaw.map(j => [j.job_id, j])).values()];
    const foundPositions = unique.map(mapRawJob);

    console.log(
      `\n🔍 Round ${round} found ${foundPositions.length} unique positions (total after merge: ${state.foundPositions.length + foundPositions.length})`
    );

    return { messages: [], foundPositions, searchRound: round };
  };

  return jobsSearchNode;
}
