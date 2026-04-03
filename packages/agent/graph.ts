/**
 * graph.ts — public API facade for @swipe-to-hire/agent.
 *
 * All schemas, state types, and graph builders live in src/.
 * This file re-exports everything so existing callers
 * (scheduler.ts, api.ts, cli/index.ts, tests) continue to work unchanged.
 *
 * ─── File map ───────────────────────────────────────────────────────────────
 *  src/schemas.ts               — ALL Zod schemas + LangGraph state definitions
 *  src/models.ts                — LLM model factories (makeProfileModel, etc.)
 *  src/nodes/
 *    cv-loader-node.ts          — download & parse CV PDF
 *    profile-extractor-node.ts  — LLM extraction with interrupt() HITL
 *    profile-hitl-node.ts       — Telegram-native HITL (no interrupt)
 *    jobs-search-node.ts        — query planning + JSearch MCP
 *    jobs-filter-node.ts        — de-dup + LLM filter
 *    matcher-node.ts            — score & annotate matches
 *  src/graphs/
 *    job-search-graph.ts        — assemble + compile job-search graph
 *    profile-setup-graph.ts     — assemble + compile profile-setup graph
 * ────────────────────────────────────────────────────────────────────────────
 */

// Schemas & state types — re-exported for tests and external callers
export {
  CandidateProfile,
  ExcludedPosting,
  FilterResult,
  JobLocation,
  JobPosting,
  JobSearchState,
  Match,
  MissingInfo,
  ProfileExtractionResult,
  ProfileHumanReview,
  ProfileSetupResult,
  ProfileSetupState,
  SearchQuery,
  SearchResultRawJob,
} from './src/schemas';
export type {
  CandidateProfileType,
  FilterResultType,
  JobLocationType,
  JobPostingType,
  JobSearchStateType,
  MatchType,
  MissingInfoType,
  ProfileExtractionResultType,
  ProfileHumanReviewType,
  ProfileSetupResultType,
  ProfileSetupStateType,
  SearchQueryType,
  SearchResultRawJobType,
} from './src/schemas';

// Graph builders — callers use these; node files are internal
export { buildJobSearchGraph } from './src/graphs/job-search-graph';
export type { BuildJobSearchGraphOptions } from './src/graphs/job-search-graph';

export { buildProfileSetupGraph } from './src/graphs/profile-setup-graph';
export type { BuildProfileSetupGraphOptions } from './src/graphs/profile-setup-graph';

// Legacy alias — scheduler.ts, cli/index.ts, bot.ts call `buildGraph()`
export { buildJobSearchGraph as buildGraph } from './src/graphs/job-search-graph';
export type { BuildJobSearchGraphOptions as BuildGraphOptions } from './src/graphs/job-search-graph';
