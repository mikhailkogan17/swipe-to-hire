/**
 * schemas.ts — all Zod schemas and derived TypeScript types for the agent package.
 *
 * Import from here in nodes, graphs, and graph.ts (re-export facade).
 * Never duplicate schema definitions elsewhere.
 */

import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Candidate profile schemas
// ---------------------------------------------------------------------------

export const MissingInfo = z
  .object({
    fields: z.array(z.string()).min(1, 'Fields required'),
    question: z.string().min(1, 'Question required'),
  })
  .strict();
export type MissingInfoType = z.infer<typeof MissingInfo>;

export const CandidateProfile = z
  .object({
    name: z.string().min(1, 'Name required'),
    preferredRole: z.string(),
    summary: z.string(),
    email: z.email().optional(),
    links: z
      .array(
        z.object({
          title: z.string().optional(),
          url: z.url(),
        })
      )
      .default([]),
    phone: z.string().optional(),
    skills: z.array(z.string()),
    yearsOfExperience: z.number().min(0).max(30),
    currentRole: z.string().optional(),
    targetRole: z.string(),
    experience: z.array(
      z.object({
        company: z.string(),
        role: z.string(),
        period: z.string(),
        achievements: z.array(z.string()).default([]),
      })
    ),
    languages: z.array(z.string()).default([]),
    location: z.string(),
  })
  .strict();
export type CandidateProfileType = z.infer<typeof CandidateProfile>;

export const ProfileHumanReview = z
  .object({
    question: z.string().min(1, 'Question required'),
    profile: CandidateProfile,
  })
  .strict();
export type ProfileHumanReviewType = z.infer<typeof ProfileHumanReview>;

export const ProfileExtractionResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), profile: CandidateProfile }),
  z.object({ status: z.literal('missingInfo'), missingInfo: MissingInfo }),
  z.object({ status: z.literal('needsHumanReview'), humanReview: ProfileHumanReview }),
]);
export type ProfileExtractionResultType = z.infer<typeof ProfileExtractionResult>;

// ---------------------------------------------------------------------------
// Job search schemas
// ---------------------------------------------------------------------------

export const SearchQuery = z.object({
  query: z.string().describe("Search query, e.g. 'LangGraph engineer'"),
  country: z.string().optional().describe("Country code, e.g. 'il'"),
  work_from_home: z.boolean().optional().describe('Work from home, e.g. true'),
  num_pages: z.number().default(1).describe('Number of pages, e.g. 1'),
});
export type SearchQueryType = z.infer<typeof SearchQuery>;

export const JobLocation = z
  .object({
    address: z.string().optional(),
    addressKind: z.enum(['city', 'country', 'global']).default('global'),
    workType: z.enum(['remote', 'onsite', 'hybrid']).default('onsite'),
  })
  .strict();
export type JobLocationType = z.infer<typeof JobLocation>;

export const JobPosting = z
  .object({
    jobId: z.string(),
    title: z.string(),
    company: z.string(),
    applyUrl: z.string(),
    requiredSkills: z.array(z.string()),
    minExperience: z.number(),
    locations: z.array(JobLocation).default([]),
  })
  .strict();
export type JobPostingType = z.infer<typeof JobPosting>;

export const Match = z
  .object({
    posting: JobPosting,
    conformancePercentage: z.number().min(0).max(100),
    agentNotes: z.string().optional(),
    needsHumanReview: z.boolean().default(false),
  })
  .strict();
export type MatchType = z.infer<typeof Match>;

export const ExcludedPosting = z.object({
  posting: JobPosting,
  reason: z.string(),
});

export const FilterResult = z.object({
  filtered: z.array(JobPosting),
  excluded: z.array(ExcludedPosting).default([]),
});
export type FilterResultType = z.infer<typeof FilterResult>;

/** Raw shape returned by the RapidAPI JSearch MCP tool */
export const SearchResultRawJob = z
  .object({
    job_id: z.string(),
    job_title: z.string(),
    employer_name: z.string(),
    job_apply_link: z.string().optional(),
    job_google_link: z.string().optional(),
    job_is_remote: z.boolean().default(false),
    job_city: z.string().optional(),
    job_state: z.string().optional(),
    job_country: z.string().optional(),
    job_required_experience: z
      .object({ required_experience_in_months: z.number().optional() })
      .optional(),
    job_required_skills: z.array(z.string()).optional(),
    job_onet_job_zone: z.number().optional(),
  })
  .strict();
export type SearchResultRawJobType = z.infer<typeof SearchResultRawJob>;

// ---------------------------------------------------------------------------
// LangGraph state schemas
// ---------------------------------------------------------------------------

/** State for the main job-search graph */
export const JobSearchState = new StateSchema({
  messages: MessagesValue,
  // ── per-user context (set once by graph builder, read by all nodes) ──
  telegramUserId: z.number(),
  openrouterKey: z.string(),
  rapidApiKey: z.string(),
  // ── domain state ──
  profile: CandidateProfile.optional(),
  searchRound: new ReducedValue(z.number().default(0), {
    reducer: (_current: number, next: number) => next,
  }),
  foundPositions: new ReducedValue(z.array(JobPosting).default([]), {
    reducer: (current: JobPostingType[], next: JobPostingType[]) => [...current, ...next],
  }),
  filteredPositions: new ReducedValue(z.array(JobPosting).default([]), {
    reducer: (current: JobPostingType[], next: JobPostingType[]) => [...current, ...next],
  }),
  matches: new ReducedValue(z.array(Match).default([]), {
    reducer: (current: MatchType[], next: MatchType[]) => [...current, ...next],
  }),
});
export type JobSearchStateType = typeof JobSearchState.State;

/** State for the profile-setup (onboarding) graph */
export const ProfileSetupState = new StateSchema({
  messages: MessagesValue,
  // ── per-user context (set once by graph builder, read by all nodes) ──
  telegramUserId: z.number(),
  openrouterKey: z.string(),
  // ── domain state ──
  /** Raw CV text extracted from the URL */
  cvText: new ReducedValue(z.string().default(''), {
    reducer: (_cur: string, next: string) => next,
  }),
  /** CV content hash (SHA-256) — used for cache keying */
  cvHash: new ReducedValue(z.string().default(''), {
    reducer: (_cur: string, next: string) => next,
  }),
  /** Number of HITL clarification rounds completed */
  clarificationRound: new ReducedValue(z.number().default(0), {
    reducer: (_cur: number, next: number) => next,
  }),
  /** Whether profile was successfully validated */
  profileReady: new ReducedValue(z.boolean().default(false), {
    reducer: (_cur: boolean, next: boolean) => next,
  }),
});
export type ProfileSetupStateType = typeof ProfileSetupState.State;

// ---------------------------------------------------------------------------
// Profile-setup graph public API
// ---------------------------------------------------------------------------

export const ProfileSetupResult = z.object({
  profileReady: z.boolean(),
  /** Optional message to show the user after setup */
  message: z.string().optional(),
});
export type ProfileSetupResultType = z.infer<typeof ProfileSetupResult>;

// Legacy alias — some tests may reference AgentState directly
export const AgentState = JobSearchState;
export type AgentStateTypeAlias = JobSearchStateType;
