import { z } from 'zod';
import { 
  BaseMessage,
  HumanMessage, 
  SystemMessage,
  AIMessage,
  createAgent,
  toolStrategy,
  providerStrategy,
} from 'langchain';
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf"
import { ChatOpenRouter } from '@langchain/openrouter';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { env } from './env'
import { 
  getUser,
  updateUserProfile,
  getUserInsights,
  getUserPreferences,
  getSentJobIds,
  addAdditionalInfoForUser,
  getAdditionalInfoForUser,
  hashCV,
  getProfileCache,
  saveProfileCache,
} from './db'
import { 
  StateGraph, 
  StateSchema, 
  ReducedValue, 
  MessagesValue, 
  START, 
  END, 
  MemorySaver,
  interrupt
} from '@langchain/langgraph';

// --- Options ---

export interface BuildGraphOptions {
  telegramUserId: number
  apiKeys?: {
    openrouterKey?: string
    rapidApiKey?: string
  }
}

// --- Profile Setup Graph — Options & Schemas ---
// Separate LangGraph dedicated to the onboarding/profile-setup phase.
// Runs BEFORE the main job-search graph; the main graph reads its output from DB.

export interface BuildProfileGraphOptions {
  telegramUserId: number
  /** Telegram sendMessage callback — used to deliver HITL questions to the user */
  sendMessage: (text: string) => Promise<void>
  /** Resolves the next message the user sends back to the bot — used for HITL waiting */
  waitForReply: () => Promise<string>
  apiKeys?: {
    openrouterKey?: string
  }
}

/**
 * State for the profile-setup graph.
 * Carries messages, the CV text, intermediate extraction results, and
 * final validated profile.
 */
export const ProfileSetupState = new StateSchema({
  messages: MessagesValue,
  /** Raw CV text extracted from the URL */
  cvText: new ReducedValue(z.string().default(''), {
    reducer: (_cur, next) => next,
  }),
  /** CV content hash (SHA-256) — used for cache keying */
  cvHash: new ReducedValue(z.string().default(''), {
    reducer: (_cur, next) => next,
  }),
  /** Number of HITL clarification rounds completed */
  clarificationRound: new ReducedValue(z.number().default(0), {
    reducer: (_cur, next) => next,
  }),
  /** Whether profile was successfully validated */
  profileReady: new ReducedValue(z.boolean().default(false), {
    reducer: (_cur, next) => next,
  }),
})

/**
 * Result returned by buildProfileGraph after successful completion.
 * The profile itself is persisted to DB inside the graph; callers only
 * need the ready flag and any final message to show the user.
 */
export const ProfileSetupResult = z.object({
  profileReady: z.boolean(),
  message: z.string().optional(),
})

// TODO(user): Implement `buildProfileGraph` — a standalone LangGraph for onboarding profile setup.
//
// The graph runs DURING onboarding and handles:
//   1. CV download + text extraction (same logic as profileExtractorNode in the main graph)
//   2. Profile extraction via LLM (profileExtractorAgent — reuse from main graph)
//   3. HITL loop: if extraction returns missingInfo or needsHumanReview → ask user via Telegram,
//      wait for reply, retry extraction. No in-process interrupt() — uses real async Telegram messages.
//   4. On success: save to DB (saveProfileCache + updateUserProfile), return ProfileSetupResult
//
// Graph nodes:
//   START → cvLoader → profileExtractor → [conditional] → hitlQuestion → profileExtractor (retry)
//                                                       └─ (success) → END
//
// Step-by-step implementation:
//
// 1. Create `ProfileSetupState` (already defined above).
//
// 2. Define `cvLoaderNode`:
//    ```
//    const cvLoaderNode = async (state) => {
//      const cvUrl = getUser(telegramUserId)?.cv_url ?? env.CV_URL
//      const response = await fetch(cvUrl)
//      const blob = await response.blob()
//      const docs = await new WebPDFLoader(blob).load()
//      const cvText = docs[0]?.pageContent ?? ''
//      const cvHash = hashCV(cvText)
//      return { cvText, cvHash, messages: [new HumanMessage(cvText)] }
//    }
//    ```
//
// 3. Define `profileExtractorNode`:
//    - Reuse profileExtractorAgent (providerStrategy(ProfileExtractionResult))
//    - Check DB cache first (getProfileCache): if hit and hash matches → skip LLM, return ready=true
//    - Call agent.invoke({ messages: state.messages })
//    - Return { messages, profileReady: result.status === 'success', ... }
//
// 4. Define `hitlQuestionNode`:
//    - Call options.sendMessage(missingInfo.question or humanReview.question)
//    - Call options.waitForReply() → blocks until user responds in Telegram
//    - Push HumanMessage(reply) to messages
//    - Increment clarificationRound
//    - Return { messages, clarificationRound }
//
// 5. Add conditional edge from profileExtractorNode:
//    - if state.profileReady → END
//    - if state.clarificationRound >= 3 → END (give up, allow search to proceed without HITL answer)
//    - else → hitlQuestionNode
//
// 6. Save to DB inside profileExtractorNode on success:
//    saveProfileCache(telegramUserId, cvHash, cvUrl, profile)
//    updateUserProfile(telegramUserId, cvHash, cvUrl, JSON.stringify(profile))
//
// 7. Export:
//    export async function buildProfileGraph(options: BuildProfileGraphOptions): Promise<any>
//
// Caller (api.ts /onboarding/complete):
//   - Create a Promise-based reply waiter: store resolve in a Map keyed by telegramUserId
//   - In bot.ts on('text'), if map has entry for this userId → call resolve(text)
//   - Pass sendMessage and waitForReply to buildProfileGraph
//   - Await graph.invoke BEFORE triggering runJobSearchForUser
//
// IMPORTANT: The main graph's profileExtractorNode already reads from DB cache.
//   So once buildProfileGraph saves the profile, the main graph skips extraction entirely.
export async function buildProfileGraph(_options: BuildProfileGraphOptions): Promise<never> {
  throw new Error(
    'buildProfileGraph is not yet implemented. ' +
    'Follow the TODO(user) instructions in graph.ts to implement it.'
  )
}

// --- Zod schemas ---

export const MissingInfo = z.object({
  fields: z.array(z.string()).min(1, "Fields required"),
  question: z.string().min(1, "Question required")
}).strict()

export const CandidateProfile = z.object({
  name: z.string().min(1, "Name required"),
  preferredRole: z.string(),
  summary: z.string(),
  email: z.email().optional(),
  links: z.array(z.object({
      title: z.string().optional(),
      url: z.url()
  })).default([]),
  phone: z.string().optional(),
  skills: z.array(z.string()),
  yearsOfExperience: z.number().min(0).max(30),
  currentRole: z.string().optional(),
  targetRole: z.string(),
  experience: z.array(z.object({
    company: z.string(),
    role: z.string(),
    period: z.string(),
    achievements: z.array(z.string()).default([]),
  })),
  languages: z.array(z.string()).default([]),
  location: z.string()
}).strict();

export const ProfileHumanReview = z.object({
  question: z.string().min(1, "Question required"),
  profile: CandidateProfile
}).strict()

export const ProfileExtractionResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    profile: CandidateProfile
  }),
  z.object({
    status: z.literal("missingInfo"),
    missingInfo: MissingInfo
  }),
  z.object({
    status: z.literal("needsHumanReview"),
    humanReview: ProfileHumanReview,
  })
]);

const JobLocation = z.object({
    address: z.string().optional(),
    addressKind: z.enum(["city", "country", "global"]).default("global"),
    workType: z.enum(["remote", "onsite", "hybrid"]).default("onsite")
}).strict()

const JobPosting = z.object({
  jobId: z.string(),
  title: z.string(),
  company: z.string(),
  applyUrl: z.string(),
  requiredSkills: z.array(z.string()),
  minExperience: z.number(),
  locations: z.array(JobLocation).default([])
}).strict()
type JobPostingType = z.infer<typeof JobPosting>

export const SearchQuery = z.object({
  query: z.string().describe("Search query, e.g. 'LangGraph engineer'"),
  country: z.string().optional().describe("Country code, e.g. 'il'"),
  work_from_home: z.boolean().optional().describe("Work from home, e.g. true"),
  num_pages: z.number().default(1).describe("Number of pages, e.g. 1"),
})

const SearchResultRawJob = z.object({
  job_id: z.string(),
  job_title: z.string(),
  employer_name: z.string(),
  job_apply_link: z.string().optional(),
  job_google_link: z.string().optional(),
  job_is_remote: z.boolean().default(false),
  job_city: z.string().optional(),
  job_state: z.string().optional(),
  job_country: z.string().optional(),
  job_required_experience: z.object({
    required_experience_in_months: z.number().optional()
  }).optional(),
  job_required_skills: z.array(z.string()).optional(),
  job_onet_job_zone: z.number().optional()
}).strict()
type SearchResultRawJobType = z.infer<typeof SearchResultRawJob>

const Match = z.object({
    posting: JobPosting,
    conformancePercentage: z.number().min(0).max(100),
    agentNotes: z.string().optional(),
    needsHumanReview: z.boolean().default(false)
}).strict()

const ExcludedPosting = z.object({
  posting: JobPosting,
  reason: z.string()
})

const FilterResult = z.object({
  filtered: z.array(JobPosting),
  excluded: z.array(ExcludedPosting).default([])
})

const AgentState = new StateSchema({ 
    messages: MessagesValue,
    profile: CandidateProfile.optional(),
    searchRound: new ReducedValue(z.number().default(0), {
        reducer: (_current, next) => next,
    }),
    foundPositions: new ReducedValue( z.array(JobPosting).default([]), {
        reducer: (current, next) => [...current, ...next],
    }),
    filteredPositions: new ReducedValue( z.array(JobPosting).default([]), {
        reducer: (current, next) => [...current, ...next],
    }),
    matches: new ReducedValue( z.array(Match).default([]), {
        reducer: (current, next) => [...current, ...next],
    }),
})

// --- Graph builder ---

export async function buildGraph(options: BuildGraphOptions): Promise<any> {
  console.log('🏗️  Building graph for user', options.telegramUserId);

  const openrouterKey = options.apiKeys?.openrouterKey ?? env.OPENROUTER_API_KEY
  const rapidApiKey = options.apiKeys?.rapidApiKey ?? process.env.RAPIDAPI_KEY!

  // --- Models ---

  const profileModel = new ChatOpenRouter({
    model: "openai/gpt-4o",
    apiKey: openrouterKey,
    temperature: 0.1
  })

  const jobsSearchModel = new ChatOpenRouter({
    model: "openai/gpt-4o",
    apiKey: openrouterKey,
    temperature: 0.1
  })

  const jobsFilterModel = new ChatOpenRouter({
    model: "openai/gpt-4o",
    apiKey: openrouterKey,
    temperature: 0.1
  })

  const matchModel = new ChatOpenRouter({
    model: "openai/gpt-4o",
    apiKey: openrouterKey,
    temperature: 0.3
  })

  // --- Tools ---

  const mcpClient = new MultiServerMCPClient({
    jsearch: {
      transport: "http",
      url: "https://mcp.rapidapi.com",
      headers: {
        "x-api-host": "jsearch.p.rapidapi.com",
        "x-api-key": rapidApiKey,
      },
    },
  })

  const tools = await mcpClient.getTools()
  console.log(`🔧 MCP tools loaded: ${tools.map(t => t.name).join(', ') || 'NONE'}`)
  const searchTool = tools.find(t => t.name === 'Job_Search')
  if (!searchTool) {
    throw new Error("Job_Search tool not found")
  }

  // --- Agents ---

  const profileExtractorAgent = createAgent({
    model: profileModel,
    systemPrompt: `
    You are a helpful precise and pedantic CV data extractor. 
    If some parameters are missing, ask user to provide them.
    If you are not confident, ask user to review the extracted data.
    Otherwise, return the extracted data.
    Respect both the input data and the output format.
    `,
    responseFormat: providerStrategy(ProfileExtractionResult)
  })

  const jobsSearchQueryAgent = createAgent({
    model: jobsSearchModel,
    systemPrompt: `
    You are a job search query planner.
    Generate 3-4 DIVERSE, BROAD search queries to find as many relevant job postings as possible.

    RULES:
    - NEVER add location constraints (no country, city, remote/onsite). The search engine defaults to US which is fine.
    - NEVER add experience level, salary, or education constraints in the query string.
    - Use a MIX of: role title queries AND skill-based queries.
    - If already-found jobs are provided, generate queries that find DIFFERENT positions (different companies, different role angles).
    - ALWAYS RESPECT RESPONSE FORMAT.

    Good query examples: "LangGraph engineer", "MCP platform developer", "AI infrastructure engineer", "agentic systems TypeScript"
    Bad query examples: "Remote LangGraph engineer Israel 5 years", "Senior AI Engineer Python only"
    `,
    responseFormat: z.array(SearchQuery)
  })

  const jobsFilterAgent = createAgent({
    model: jobsFilterModel,
    responseFormat: toolStrategy(FilterResult),
    systemPrompt: `
    You are a job filter agent. Your job is to REMOVE only obviously bad fits. Be PERMISSIVE — keep anything that could potentially be relevant.

    REMOVE a job only if it has ANY of the following hard blockers:
    - Requires US security clearance (Secret, TS/SCI, polygraph) — candidate is Israeli citizen, cannot obtain US clearance
    - Mandatory technology the candidate definitely lacks (e.g. job REQUIRES Python-only and candidate has no Python at all)
    - Mandatory degree the candidate does not have (e.g. "Master's required", "PhD required")
    - Requires 10+ years in a very specific narrow domain the candidate has zero experience in
    - Clearly wrong domain (embedded C firmware, iOS-only, Android-only, data science, pure frontend)

    DO NOT REMOVE:
    - Jobs in US or elsewhere onsite — the matcher will handle location concerns
    - Jobs where candidate is slightly underqualified (e.g. 8 years required, candidate has 7)
    - Jobs asking for skills adjacent to candidate's (e.g. Python when candidate has TypeScript — related)
    - Jobs with vague requirements
    - Freelance/contractor/remote jobs even if they seem informal

    Respect the output format.
    - filtered: jobs that passed (keep)
    - excluded: jobs removed, each with a short reason (1 sentence)
    `
  })

  const matchAgent = createAgent({
    model: matchModel,
    responseFormat: toolStrategy(z.array(Match)),
    systemPrompt: `
    You are a job matching agent. Evaluate each job against the candidate's profile.

    SCORING:
    - conformancePercentage: 0-100 based on skills match, role fit, and seniority alignment
    - needsHumanReview: set to TRUE if any of the following apply:
      * Job is onsite in a country where the candidate doesn't live (e.g. US onsite for Israeli candidate)
      * Job strictly requires a technology the candidate doesn't have (Python, Java, etc.)
      * Job requires a credential the candidate may lack (Master's degree, specific certification)
      * Significant mismatch in years of experience required
    - agentNotes: ALWAYS write a short note. For needsHumanReview=true, start with "⚠️ Concern: [specific issue]" then explain the fit.

    Be direct. State what matches and what doesn't.
    Respect the output format.
    `
  })

  // --- Nodes ---

  const { telegramUserId } = options
  const user = getUser(telegramUserId)

  const profileExtractorNode = async (state: typeof AgentState.State) => { 
    console.log('📄 Loading CV...')

    const cvUrl = user?.cv_url ?? env.CV_URL
    if (!cvUrl) throw new Error('No CV URL — set CV_URL in .env or onboard user via bot')
    const response = await fetch(cvUrl)
    const blob = await response.blob()
    const cvDocumentLoader = new WebPDFLoader(blob)
    const cvDocuments = await cvDocumentLoader.load()
    const cvContent = cvDocuments[0]?.pageContent
    console.log(`📄 CV loaded (${cvContent?.length ?? 0} chars)`)
    if (!cvContent) {
      throw new Error("CV file parsing failed")
    }

    // check DB cache
    const cvHash = hashCV(cvContent)
    const cached = getProfileCache(telegramUserId)
    if (cached && cached.cvHash === cvHash) {
      console.log('✅ Profile loaded from cache')
      return { messages: [], profile: cached.profile }
    }

    // prepare messages with additional info from DB
    let messages: BaseMessage[] = [new HumanMessage(cvContent)]
    const additionalInfo = user ? getAdditionalInfoForUser(user.id) : []
    const currentCvInfo = additionalInfo.filter(i => i.cv_hash === cvHash)
    const previousCvInfo = additionalInfo.filter(i => i.cv_hash !== cvHash)
    if (currentCvInfo.length > 0) {
      messages.push(new SystemMessage(`
      Previously answered questions (same CV version - high confidence):
      ${currentCvInfo.map(i => `- ${i.field}: ${i.answer}`).join('\n')}
      `))
    }
    if (previousCvInfo.length > 0) {
      messages.push(new SystemMessage(`
      Previously answered questions (older CV versions - use with caution):
      ${previousCvInfo.map(i => `- ${i.field}: ${i.answer} [answered ${i.answered_at}]`).join('\n')}
      If any answer seems outdated or contradicts the CV, ask the user to confirm.
      `))
    }

    // extract profile
    console.log('🤖 Extracting profile...')
    let result = await profileExtractorAgent.invoke({ messages })
    while (result.structuredResponse?.status !== "success") {
      if (!result.structuredResponse) {
        console.error('❌ No structuredResponse:', JSON.stringify(result, null, 2))
        throw new Error('Agent returned no structuredResponse')
      }
      if (result.structuredResponse.status === "missingInfo") {
        const missingInfo = result.structuredResponse.missingInfo
        messages.push(new AIMessage(JSON.stringify(missingInfo)))
        const answer = interrupt(missingInfo)
        if (user) {
          addAdditionalInfoForUser(user.id, missingInfo.fields.join(", "), answer, cvHash)
        }
        messages.push(new HumanMessage(answer))
        result = await profileExtractorAgent.invoke({ messages })
      } else if (result.structuredResponse.status === "needsHumanReview") {
        const humanReview = result.structuredResponse.humanReview
        messages.push(new AIMessage(JSON.stringify(humanReview)))
        const answer = interrupt(humanReview)
        if (user) {
          addAdditionalInfoForUser(user.id, humanReview.question, answer, cvHash)
        }
        messages.push(new HumanMessage(answer))
        result = await profileExtractorAgent.invoke({ messages })
      }
    }

    // save to DB
    saveProfileCache(telegramUserId, cvHash, cvUrl, result.structuredResponse.profile)
    updateUserProfile(telegramUserId, cvHash, cvUrl, JSON.stringify(result.structuredResponse.profile))

    console.log(`✅ Profile extracted: ${result.structuredResponse.profile?.name} → ${result.structuredResponse.profile?.targetRole}`)
    return { 
      messages: messages,
      profile: result.structuredResponse.profile
    }
  };

  const jobsSearchNode = async (state: typeof AgentState.State) => {
    const round = (state.searchRound ?? 0) + 1
    console.log(`\n🔍 Search round ${round}... (found so far: ${state.foundPositions.length})`)

    const messages: BaseMessage[] = [
      new HumanMessage(`
      Candidate profile:
      ${JSON.stringify(state.profile, null, 2)}
      
      Already found job titles (do NOT repeat these):
      ${JSON.stringify(state.foundPositions.map(p => p.title), null, 2)}
      `)
    ]

    // Inject user insights and preferences
    const insights = getUserInsights(user?.id ?? 0)
    const prefs = getUserPreferences(telegramUserId)
    if (insights.length > 0) {
      messages.push(new SystemMessage(
        `User job-search insights (use to prioritise / de-prioritise):\n${insights.map(i => `- ${i}`).join('\n')}`
      ))
    }
    if (prefs.preferredRoles?.length) {
      messages.push(new SystemMessage(`Preferred roles: ${prefs.preferredRoles.join(', ')}`))
    }
    if (prefs.remoteOnly) {
      messages.push(new SystemMessage(`User wants remote jobs only — include work_from_home:true in ALL queries`))
    }

    const queriesResult = await jobsSearchQueryAgent.invoke({ messages })
    const queries = queriesResult.structuredResponse ?? []
    console.log(`🔍 Queries Result:`, queriesResult)
    console.log(`🔍 Planned queries:`, queries.map(q => q.query))

    if (queries.length === 0) {
      console.warn('⚠️  Query planner returned empty list')
      return { messages: [], foundPositions: [], searchRound: round }
    }

    const rawResponses = await Promise.all(
      queries.map(q => searchTool.invoke(q))
    )

    rawResponses.forEach((r, i) => {
      const raw = typeof r === 'string' ? r : JSON.stringify(r)
      const parsed = JSON.parse(raw)
      console.log(`\n📦 ===== RapidAPI Query ${i+1}: "${queries[i].query}" =====`)
      console.log(`📦 Status: ${parsed.status} | Jobs: ${parsed.data?.length ?? 0}`)
      console.log(`📦 Full response:\n${JSON.stringify(parsed, null, 2)}`)
    })

    const allRaw: (SearchResultRawJobType & any)[] = rawResponses.flatMap(response => {
      const parsed = JSON.parse(typeof response === 'string' ? response : JSON.stringify(response))
      return parsed.data ?? []
    })
    const unique = [...new Map(allRaw.map(j => [j.job_id, j])).values()]

    const foundPositions: z.infer<typeof JobPosting>[] = unique.map(job => ({
      jobId: job.job_id,
      title: job.job_title,
      company: job.employer_name ?? 'Unknown',
      applyUrl: job.job_apply_link ?? job.job_google_link ?? '',
      requiredSkills: job.job_required_skills ?? [],
      minExperience: Math.round((job.job_required_experience?.required_experience_in_months ?? 0) / 12),
      locations: [
        {
          address: job.job_city ?? job.job_state ?? job.job_country ?? undefined,
          addressKind: job.job_country ? 'country' : 'global',
          workType: job.job_is_remote ? 'remote' : 'onsite'
        }
      ]
    }))

    console.log(`\n🔍 Round ${round} found ${foundPositions.length} unique positions (total after merge: ${state.foundPositions.length + foundPositions.length})`)
    console.log('🔍 Search round update:', { searchRound: round, newPositions: foundPositions.map(p => p.title + ' at ' + p.company) })

    return { messages: [], foundPositions, searchRound: round }
  };

  const jobsFilterNode = async (state: typeof AgentState.State) => {
    const sentIds = new Set(getSentJobIds(user?.id ?? 0))
    const alreadySent = state.foundPositions.filter(p => sentIds.has(p.jobId))
    const freshPositions = state.foundPositions.filter(p => !sentIds.has(p.jobId))
    console.log(`Before filtering: ${state.foundPositions.length} total → ${alreadySent.length} already sent → ${freshPositions.length} fresh`)

    let messages: BaseMessage[] = []

    // Inject excluded skills from user preferences
    const prefs = getUserPreferences(telegramUserId)
    if (prefs.excludedSkills?.length) {
      messages.push(new SystemMessage(
        `Also EXCLUDE jobs that REQUIRE these skills (user explicitly doesn't want them): ${prefs.excludedSkills.join(', ')}`
      ))
    }

    if (alreadySent.length > 0) {
      messages.push(new SystemMessage("You already sent these jobs to the user. Skip them:" + JSON.stringify(alreadySent)))
    }
    messages.push(new HumanMessage(
      JSON.stringify({ profile: state.profile, positions: freshPositions })
    ))
    const result = await jobsFilterAgent.invoke({ messages })
    const filterResult: { filtered?: any[], excluded?: any[] } = result.structuredResponse ?? { filtered: [], excluded: [] }
    const filtered = filterResult.filtered ?? []
    const excluded = filterResult.excluded ?? []
    console.log(`🧹 Kept: ${filtered.length} | Excluded: ${excluded.length}`)
    if (excluded.length > 0) {
      console.log('🧹 Excluded:')
      excluded.forEach((e: any) => console.log(`   ✗ ${e.posting?.title ?? '?'} — ${e.reason}`))
    }
    return {
      messages: messages,
      filteredPositions: filtered
    }
  };

  const matcherNode = async (state: typeof AgentState.State) => {
    console.log(`🎯 Matching ${state.filteredPositions?.length ?? 0} positions...`)
    const humanMessage = new HumanMessage(
      JSON.stringify({ profile: state.profile, positions: state.filteredPositions })
    )
    const result = await matchAgent.invoke({ messages: [humanMessage] })
    console.log(`🎯 Got ${result.structuredResponse?.length ?? 0} matches`)
    return {
      messages: [humanMessage],
      matches: result.structuredResponse
    }
  };

  // --- Compile graph ---

  const graph = new StateGraph(AgentState)
    .addNode("profileExtractor", profileExtractorNode)
    .addNode("jobsSearch", jobsSearchNode)
    .addNode("jobsFilter", jobsFilterNode)
    .addNode("matcher", matcherNode)
    .addEdge(START, "profileExtractor")
    .addEdge("profileExtractor", "jobsSearch")
    .addEdge("jobsSearch", "jobsFilter")
    .addConditionalEdges("jobsFilter", (state) => {
      const round = state.searchRound ?? 0
      const hasAny = state.filteredPositions.length > 0
      const tooManyRounds = round >= 3
      if (!hasAny && !tooManyRounds) {
        console.log(`🔄 0 filtered positions after round ${round}, retrying search...`)
        return "jobsSearch"
      }
      console.log(`✅ Proceeding to matcher with ${state.filteredPositions.length} filtered positions (round ${round})`)
      return "matcher"
    })
    .addEdge("matcher", END)

  return graph.compile({ checkpointer: new MemorySaver() });
}