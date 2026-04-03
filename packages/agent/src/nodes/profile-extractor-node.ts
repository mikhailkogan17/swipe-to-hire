/**
 * profile-extractor-node.ts — node for the JOB-SEARCH graph.
 *
 * Loads CV from URL, hashes it, checks DB cache, calls LLM to extract
 * CandidateProfile, persists result to DB. Uses LangGraph interrupt() for
 * HITL (missingInfo / needsHumanReview).
 *
 * Used in: graphs/job-search-graph.ts  (START → profileExtractor → jobsSearch)
 */

import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import { interrupt } from '@langchain/langgraph';
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  createAgent,
  providerStrategy,
} from 'langchain';
import {
  addAdditionalInfoForUser,
  getAdditionalInfoForUser,
  getProfileCache,
  getUser,
  hashCV,
  saveProfileCache,
  updateUserProfile,
} from '../../db';
import { env } from '../../env';
import { makeProfileModel } from '../models';
import { CandidateProfile, ProfileExtractionResult, type JobSearchStateType } from '../schemas';

// ── System prompt ─────────────────────────────────────────

const PROFILE_EXTRACTOR_PROMPT = `You are a helpful precise and pedantic CV data extractor.
If some parameters are missing, ask user to provide them.
If you are not confident, ask user to review the extracted data.
Otherwise, return the extracted data.
Respect both the input data and the output format.`;

// ── Helpers ───────────────────────────────────────────────

async function downloadAndParsePdf(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  const docs = await new WebPDFLoader(blob).load();
  const text = docs[0]?.pageContent ?? '';
  if (!text) throw new Error('CV PDF parsing produced no text');
  return text;
}

function buildAdditionalContext(
  additionalInfo: Array<{ cv_hash: string; field: string; answer: string; answered_at: string }>,
  cvHash: string
): BaseMessage[] {
  const messages: BaseMessage[] = [];
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
  return messages;
}

// ── Node ──────────────────────────────────────────────────

export const profileExtractorNode = async (
  state: JobSearchStateType
): Promise<Partial<JobSearchStateType>> => {
  const { telegramUserId, openrouterKey } = state;
  const user = getUser(telegramUserId);

  // 1. Resolve CV URL
  console.log('📄 Loading CV...');
  const cvUrl = user?.cv_url ?? env.CV_URL;
  if (!cvUrl) throw new Error('No CV URL — set CV_URL in .env or onboard user via bot');

  // 2. Download + parse
  const cvContent = await downloadAndParsePdf(cvUrl);
  console.log(`📄 CV loaded (${cvContent.length} chars)`);

  // 3. Hash + cache check
  const cvHash = hashCV(cvContent);
  const cached = getProfileCache(telegramUserId);
  if (cached && cached.cvHash === cvHash) {
    console.log('✅ Profile loaded from cache');
    return { messages: [], profile: cached.profile as any };
  }

  // 4. Build messages with additional context
  let messages: BaseMessage[] = [new HumanMessage(cvContent)];
  const additionalInfo = user ? getAdditionalInfoForUser(user.id) : [];
  messages = [...messages, ...buildAdditionalContext(additionalInfo, cvHash)];

  // 5. Create agent and extract
  const agent = createAgent({
    model: makeProfileModel({ apiKey: openrouterKey }),
    systemPrompt: PROFILE_EXTRACTOR_PROMPT,
    responseFormat: providerStrategy(ProfileExtractionResult),
  });

  console.log('🤖 Extracting profile...');
  let result = await agent.invoke({ messages });

  // 6. HITL loop via interrupt()
  while (result.structuredResponse?.status !== 'success') {
    if (!result.structuredResponse) {
      console.error('❌ No structuredResponse:', JSON.stringify(result, null, 2));
      throw new Error('Agent returned no structuredResponse');
    }

    if (result.structuredResponse.status === 'missingInfo') {
      const missingInfo = result.structuredResponse.missingInfo;
      messages.push(new AIMessage(JSON.stringify(missingInfo)));
      const answer = interrupt(missingInfo);
      if (user) {
        addAdditionalInfoForUser(user.id, missingInfo.fields.join(', '), answer, cvHash);
      }
      messages.push(new HumanMessage(answer));
      result = await agent.invoke({ messages });
    } else if (result.structuredResponse.status === 'needsHumanReview') {
      const humanReview = result.structuredResponse.humanReview;
      messages.push(new AIMessage(JSON.stringify(humanReview)));
      const answer = interrupt(humanReview);
      if (user) {
        addAdditionalInfoForUser(user.id, humanReview.question, answer, cvHash);
      }
      messages.push(new HumanMessage(answer));
      result = await agent.invoke({ messages });
    }
  }

  // 7. Persist — parse through Zod to apply .default() fields (links, languages, etc.)
  const profile = CandidateProfile.parse(result.structuredResponse.profile);
  saveProfileCache(telegramUserId, cvHash, cvUrl, profile);
  updateUserProfile(telegramUserId, cvHash, cvUrl, JSON.stringify(profile));
  console.log(`✅ Profile extracted: ${profile.name} → ${profile.targetRole}`);

  return { messages, profile };
};
