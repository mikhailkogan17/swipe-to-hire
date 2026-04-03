/**
 * job-search-graph.ts — the main job-search LangGraph pipeline.
 *
 * Graph topology:
 *
 *   START
 *     │
 *     ▼
 *   profileExtractor   (CV download → LLM extraction → DB cache)
 *     │
 *     ▼
 *   jobsSearch         (query planning → JSearch MCP → foundPositions)
 *     │
 *     ▼
 *   jobsFilter ────────────────────────────────────────────────────────┐
 *     │  if filteredPositions.length > 0 OR searchRound >= 3          │
 *     ▼                                                               │ retry
 *   matcher            (score + needsHumanReview + agentNotes)        │
 *     │                                                          ◄────┘
 *     ▼                                               (if 0 filtered AND round < 3)
 *   END
 *
 * Caller (scheduler.ts / api.ts):
 *   const graph = await buildJobSearchGraph({ telegramUserId, apiKeys })
 *   const result = await graph.invoke(
 *     { telegramUserId, openrouterKey, rapidApiKey },
 *     { configurable: { thread_id: String(telegramUserId) } }
 *   )
 *   // result.matches: Match[]
 *
 * NOTE: This graph uses MemorySaver checkpointer + interrupt() in
 * profileExtractorNode for HITL. If you want Telegram-native HITL (no
 * interrupt), use buildProfileSetupGraph first to populate the DB cache, then
 * buildJobSearchGraph will skip extraction entirely.
 */

import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { profileExtractorNode } from '../nodes/profile-extractor-node';
import { makeJobsSearchNode } from '../nodes/jobs-search-node';
import { jobsFilterNode } from '../nodes/jobs-filter-node';
import { matcherNode } from '../nodes/matcher-node';
import { JobSearchState, type JobSearchStateType } from '../schemas';
import { env } from '../../env';

export interface BuildJobSearchGraphOptions {
  telegramUserId: number;
  apiKeys?: {
    openrouterKey?: string;
    rapidApiKey?: string;
  };
}

/**
 * Build and compile the job-search graph.
 *
 * @param options - telegramUserId and optional per-user API key overrides
 * @returns compiled LangGraph ready to invoke
 */
export async function buildJobSearchGraph(options: BuildJobSearchGraphOptions) {
  const rapidApiKey = options.apiKeys?.rapidApiKey ?? env.RAPIDAPI_KEY;

  // MCP client init is expensive — done once per graph build
  console.log('🏗️  Building job-search graph for user', options.telegramUserId);
  const mcpClient = new MultiServerMCPClient({
    jsearch: {
      transport: 'http',
      url: 'https://mcp.rapidapi.com',
      headers: {
        'x-api-host': 'jsearch.p.rapidapi.com',
        'x-api-key': rapidApiKey,
      },
    },
  });

  const tools = await mcpClient.getTools();
  console.log(`🔧 MCP tools loaded: ${tools.map(t => t.name).join(', ') || 'NONE'}`);
  const searchTool = tools.find(t => t.name === 'Job_Search');
  if (!searchTool) {
    throw new Error('Job_Search tool not found in MCP tools');
  }

  // Create the search node with MCP tool injected
  const jobsSearchNode = makeJobsSearchNode(searchTool);

  const graph = new StateGraph(JobSearchState)
    .addNode('profileExtractor', profileExtractorNode)
    .addNode('jobsSearch', jobsSearchNode)
    .addNode('jobsFilter', jobsFilterNode)
    .addNode('matcher', matcherNode)
    .addEdge(START, 'profileExtractor')
    .addEdge('profileExtractor', 'jobsSearch')
    .addEdge('jobsSearch', 'jobsFilter')
    .addConditionalEdges(
      'jobsFilter',
      (state: JobSearchStateType) => {
        const hasAny = state.filteredPositions.length > 0;
        const tooManyRounds = (state.searchRound ?? 0) >= 3;
        return !hasAny && !tooManyRounds ? 'jobsSearch' : 'matcher';
      },
      { jobsSearch: 'jobsSearch', matcher: 'matcher' }
    )
    .addEdge('matcher', END);

  return graph.compile({ checkpointer: new MemorySaver() });
}
