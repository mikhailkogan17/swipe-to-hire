/**
 * profile-hitl-node.ts — node for the PROFILE-SETUP graph.
 *
 * Handles BOTH initial LLM extraction AND the HITL clarification loop.
 * On the first call (clarificationRound === 0) it attempts extraction from
 * the CV text in state.messages. If the CV is sufficient → profileReady=true
 * immediately without ever calling sendMessage.
 *
 * On subsequent calls (the graph loops back here when extraction returns
 * missingInfo/needsHumanReview), it sends the question via Telegram and
 * awaits the user's reply.
 *
 * IMPORTANT: sendMessage and waitForReply are NOT in state — they are injected
 * by the graph builder as a closure. This is the one exception to pure
 * easyoref style: the graph builder wraps this node to inject I/O callbacks.
 *
 * Used in: graphs/profile-setup-graph.ts  (cvLoader → profileHitl ⟲ loop)
 */

import { AIMessage, HumanMessage, SystemMessage, createAgent, providerStrategy } from 'langchain';
import {
  addAdditionalInfoForUser,
  getAdditionalInfoForUser,
  getProfileCache,
  getUser,
  saveProfileCache,
  updateUserProfile,
} from '../../db';
import { makeProfileModel } from '../models';
import { CandidateProfile, ProfileExtractionResult, type ProfileSetupStateType } from '../schemas';

// ── System prompt (shared with profile-extractor-node) ────

const PROFILE_EXTRACTOR_PROMPT = `You are a helpful precise and pedantic CV data extractor.
If some parameters are missing, ask user to provide them.
If you are not confident, ask user to review the extracted data.
Otherwise, return the extracted data.
Respect both the input data and the output format.`;

// ── Helpers ───────────────────────────────────────────────

function buildExtractorAgent(openrouterKey: string) {
  return createAgent({
    model: makeProfileModel({ apiKey: openrouterKey }),
    systemPrompt: PROFILE_EXTRACTOR_PROMPT,
    responseFormat: providerStrategy(ProfileExtractionResult),
  });
}

function extractQuestion(structuredResponse: any): string {
  if (structuredResponse?.status === 'missingInfo') {
    return structuredResponse.missingInfo?.question ?? 'Please provide more information.';
  }
  if (structuredResponse?.status === 'needsHumanReview') {
    return structuredResponse.humanReview?.question ?? 'Please review the extracted data.';
  }
  return 'Could you provide more details about your experience?';
}

function extractFieldNames(structuredResponse: any): string {
  if (structuredResponse?.status === 'missingInfo') {
    return structuredResponse.missingInfo?.fields?.join(', ') ?? 'unknown';
  }
  if (structuredResponse?.status === 'needsHumanReview') {
    return structuredResponse.humanReview?.question ?? 'review';
  }
  return 'unknown';
}

// ── Node factory ─────────────────────────────────────────
// The graph builder injects sendMessage/waitForReply as a closure;
// this returns the easyoref-style (state) => Promise<Partial<State>> function.

export function makeProfileHitlNode(callbacks: {
  sendMessage: (text: string) => Promise<void>;
  waitForReply: () => Promise<string>;
}): (state: ProfileSetupStateType) => Promise<Partial<ProfileSetupStateType>> {
  const { sendMessage, waitForReply } = callbacks;

  return async state => {
    const { telegramUserId, openrouterKey } = state;
    const user = getUser(telegramUserId);
    const agent = buildExtractorAgent(openrouterKey);

    // ── First pass: check cache, then try extraction ──

    if (state.clarificationRound === 0) {
      // Check DB cache first
      const cvHash = state.cvHash;
      const cached = getProfileCache(telegramUserId);
      if (cached && cached.cvHash === cvHash) {
        console.log('✅ Profile loaded from cache');
        return { profileReady: true };
      }

      // Inject previously answered Q&A as context
      const messages = [...state.messages];
      const additionalInfo = user ? getAdditionalInfoForUser(user.id) : [];
      const currentCvInfo = additionalInfo.filter(i => i.cv_hash === cvHash);
      const previousCvInfo = additionalInfo.filter(i => i.cv_hash !== cvHash);

      if (currentCvInfo.length > 0) {
        messages.push(
          new SystemMessage(
            `Previously answered questions (same CV version — high confidence):\n${currentCvInfo.map(i => `- ${i.field}: ${i.answer}`).join('\n')}`
          )
        );
      }
      if (previousCvInfo.length > 0) {
        messages.push(
          new SystemMessage(
            `Previously answered questions (older CV versions — use with caution):\n${previousCvInfo.map(i => `- ${i.field}: ${i.answer} [answered ${i.answered_at}]`).join('\n')}\nIf any answer seems outdated or contradicts the CV, ask the user to confirm.`
          )
        );
      }

      console.log('🤖 Extracting profile from CV...');
      const result = await agent.invoke({ messages });

      if (result.structuredResponse?.status === 'success') {
        const profile = result.structuredResponse.profile;
        const cvUrl = user?.cv_url ?? '';
        saveProfileCache(telegramUserId, cvHash, cvUrl, profile);
        updateUserProfile(telegramUserId, cvHash, cvUrl, JSON.stringify(profile));
        console.log(`✅ Profile extracted: ${profile?.name} → ${profile?.targetRole}`);
        return {
          messages: [...messages, new AIMessage(JSON.stringify(result.structuredResponse))],
          profileReady: true,
        };
      }

      // Needs clarification — send question to user
      const question = extractQuestion(result.structuredResponse);
      console.log(`❓ Asking user: ${question}`);
      await sendMessage(question);
      const reply = await waitForReply();

      // Store answer in DB
      if (user) {
        addAdditionalInfoForUser(
          user.id,
          extractFieldNames(result.structuredResponse),
          reply,
          cvHash
        );
      }

      // Re-extract with the user's answer
      const updatedMessages = [
        ...messages,
        new AIMessage(JSON.stringify(result.structuredResponse)),
        new HumanMessage(reply),
      ];
      const retryResult = await agent.invoke({ messages: updatedMessages });

      if (retryResult.structuredResponse?.status === 'success') {
        const profile = retryResult.structuredResponse.profile;
        const cvUrl = user?.cv_url ?? '';
        saveProfileCache(telegramUserId, cvHash, cvUrl, profile);
        updateUserProfile(telegramUserId, cvHash, cvUrl, JSON.stringify(profile));
        console.log(`✅ Profile extracted after clarification: ${profile?.name}`);
        return {
          messages: updatedMessages,
          profileReady: true,
          clarificationRound: state.clarificationRound + 1,
        };
      }

      // Still not done — return for another loop
      return {
        messages: [
          ...updatedMessages,
          new AIMessage(JSON.stringify(retryResult.structuredResponse)),
        ],
        profileReady: false,
        clarificationRound: state.clarificationRound + 1,
      };
    }

    // ── Subsequent rounds: read last AI message, send question, get reply ──

    const lastAiMsg = [...state.messages].reverse().find(m => m._getType() === 'ai');
    let parsed: any;
    try {
      parsed = JSON.parse(lastAiMsg?.content as string);
    } catch {
      parsed = {};
    }

    const question = extractQuestion(parsed);
    console.log(`❓ Round ${state.clarificationRound + 1}: asking user: ${question}`);
    await sendMessage(question);
    const reply = await waitForReply();

    if (user) {
      addAdditionalInfoForUser(user.id, extractFieldNames(parsed), reply, state.cvHash);
    }

    const messages = [...state.messages, new HumanMessage(reply)];
    const result = await agent.invoke({ messages });

    if (result.structuredResponse?.status === 'success') {
      const profile = result.structuredResponse.profile;
      const cvUrl = user?.cv_url ?? '';
      saveProfileCache(telegramUserId, state.cvHash, cvUrl, profile);
      updateUserProfile(telegramUserId, state.cvHash, cvUrl, JSON.stringify(profile));
      console.log(`✅ Profile extracted after round ${state.clarificationRound + 1}`);
      return {
        messages,
        profileReady: true,
        clarificationRound: state.clarificationRound + 1,
      };
    }

    return {
      messages: [...messages, new AIMessage(JSON.stringify(result.structuredResponse))],
      profileReady: false,
      clarificationRound: state.clarificationRound + 1,
    };
  };
}
