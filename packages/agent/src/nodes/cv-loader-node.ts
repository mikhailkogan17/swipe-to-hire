/**
 * cv-loader-node.ts — node for the PROFILE-SETUP graph.
 *
 * Downloads the user's CV PDF, parses text, hashes it, returns cvText + cvHash.
 * Pure I/O node — no LLM calls.
 *
 * Used in: graphs/profile-setup-graph.ts  (START → cvLoader → profileHitl)
 */

import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import { HumanMessage } from 'langchain';
import { getUser, hashCV } from '../../db';
import { env } from '../../env';
import type { ProfileSetupStateType } from '../schemas';

// ── Helpers ───────────────────────────────────────────────

async function downloadAndParsePdf(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  const docs = await new WebPDFLoader(blob).load();
  const text = docs[0]?.pageContent ?? '';
  if (!text) throw new Error('CV PDF parsing produced no text');
  return text;
}

// ── Node ──────────────────────────────────────────────────

export const cvLoaderNode = async (
  state: ProfileSetupStateType
): Promise<Partial<ProfileSetupStateType>> => {
  const user = getUser(state.telegramUserId);
  const cvUrl = user?.cv_url ?? env.CV_URL;
  if (!cvUrl) {
    throw new Error('No CV URL — user must set it before profile setup');
  }

  console.log('📄 Downloading CV...');
  const cvText = await downloadAndParsePdf(cvUrl);
  const cvHash = hashCV(cvText);
  console.log(`📄 CV loaded (${cvText.length} chars, hash=${cvHash.slice(0, 8)}…)`);

  return {
    cvText,
    cvHash,
    messages: [new HumanMessage(cvText)],
  };
};
