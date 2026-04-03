/**
 * matcher-node.ts — node for the JOB-SEARCH graph.
 *
 * Scores each filtered job posting against the candidate's profile (0-100),
 * sets needsHumanReview flag, writes short agentNotes. Returns matches[].
 *
 * Used in: graphs/job-search-graph.ts (jobsFilter -> matcher -> END)
 */

import { HumanMessage, createAgent, toolStrategy } from 'langchain';
import { z } from 'zod';
import { makeMatchModel } from '../models';
import { Match, type JobSearchStateType } from '../schemas';

// -- System prompt --

const MATCH_PROMPT = [
  "You are a job matching agent. Evaluate each job against the candidate's profile.",
  '',
  'SCORING:',
  '- conformancePercentage: 0-100 based on skills match, role fit, and seniority alignment',
  '- needsHumanReview: set to TRUE if any of the following apply:',
  "  * Job is onsite in a country where the candidate doesn't live (e.g. US onsite for Israeli candidate)",
  "  * Job strictly requires a technology the candidate doesn't have (Python, Java, etc.)",
  "  * Job requires a credential the candidate may lack (Master's degree, specific certification)",
  '  * Significant mismatch in years of experience required',
  '- agentNotes: ALWAYS write a short note. For needsHumanReview=true, start with "Warning: [specific issue]" then explain the fit.',
  '',
  "Be direct. State what matches and what doesn't.",
  'Respect the output format.',
].join('\n');

// -- Node --

export const matcherNode = async (
  state: JobSearchStateType
): Promise<Partial<JobSearchStateType>> => {
  const { openrouterKey } = state;

  console.log(`Matching ${state.filteredPositions?.length ?? 0} positions...`);

  const agent = createAgent({
    model: makeMatchModel({ apiKey: openrouterKey }),
    responseFormat: toolStrategy(z.array(Match)),
    systemPrompt: MATCH_PROMPT,
  });

  const humanMessage = new HumanMessage(
    JSON.stringify({ profile: state.profile, positions: state.filteredPositions })
  );
  const result = await agent.invoke({ messages: [humanMessage] });

  // Parse each match through Zod to apply .default() fields (needsHumanReview, locations, etc.)
  const matches = (result.structuredResponse ?? []).map((m: any) => Match.parse(m));
  console.log(`Got ${matches.length} matches`);

  return {
    messages: [humanMessage],
    matches,
  };
};
