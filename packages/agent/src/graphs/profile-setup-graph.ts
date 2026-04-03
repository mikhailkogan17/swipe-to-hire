/**
 * profile-setup-graph.ts — onboarding profile-setup LangGraph pipeline.
 *
 * Graph topology:
 *
 *   START
 *     │
 *     ▼
 *   cvLoader           (download PDF → parse text → hash)
 *     │
 *     ▼
 *   profileHitl        (LLM extraction + Telegram HITL loop)
 *     │
 *     ├── profileReady === true              → END
 *     │
 *     └── profileReady === false AND         ┐
 *         clarificationRound < 3             ├── loop back → profileHitl
 *         OR  clarificationRound >= 3  ──────┘ → END (give up)
 *
 * Key difference from job-search graph:
 *   HITL is done via real Telegram messages (sendMessage + waitForReply),
 *   NOT via LangGraph interrupt(). No checkpointer needed.
 *
 * Caller (bot/api.ts POST /onboarding/complete):
 *   const graph = buildProfileSetupGraph({ telegramUserId, sendMessage, waitForReply, apiKeys })
 *   const result = await graph.invoke({
 *     telegramUserId,
 *     openrouterKey,
 *   })
 */

import { END, START, StateGraph } from '@langchain/langgraph';
import { cvLoaderNode } from '../nodes/cv-loader-node';
import { makeProfileHitlNode } from '../nodes/profile-hitl-node';
import { ProfileSetupState, type ProfileSetupStateType } from '../schemas';
import { env } from '../../env';

export interface BuildProfileSetupGraphOptions {
  telegramUserId: number;
  /** Sends a message to the user in Telegram — provided by bot.ts */
  sendMessage: (text: string) => Promise<void>;
  /** Awaits the user's next reply in Telegram — backed by profileReplyWaiters Map */
  waitForReply: () => Promise<string>;
  apiKeys?: {
    openrouterKey?: string;
  };
}

/**
 * Build and compile the profile-setup graph.
 *
 * @param options - telegramUserId, Telegram callbacks, optional API key override
 * @returns compiled LangGraph ready to invoke (no checkpointer needed)
 */
export function buildProfileSetupGraph(options: BuildProfileSetupGraphOptions) {
  const openrouterKey = options.apiKeys?.openrouterKey ?? env.OPENROUTER_API_KEY;

  // Create the HITL node with Telegram I/O callbacks injected
  const profileHitlNode = makeProfileHitlNode({
    sendMessage: options.sendMessage,
    waitForReply: options.waitForReply,
  });

  const graph = new StateGraph(ProfileSetupState)
    .addNode('cvLoader', cvLoaderNode)
    .addNode('profileHitl', profileHitlNode)
    .addEdge(START, 'cvLoader')
    .addEdge('cvLoader', 'profileHitl')
    .addConditionalEdges(
      'profileHitl',
      (state: ProfileSetupStateType) => {
        if (state.profileReady) return 'end';
        if (state.clarificationRound >= 3) return 'end'; // give up after 3 rounds
        return 'profileHitl'; // loop back for another round
      },
      { end: END, profileHitl: 'profileHitl' }
    );

  return graph.compile();
}
