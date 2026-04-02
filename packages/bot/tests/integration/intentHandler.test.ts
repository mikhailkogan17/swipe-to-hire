/**
 * Integration test: intent classification via OpenRouter API
 * Uses real LLM calls — requires OPENROUTER_API_KEY in env.
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ChatOpenRouter } from '@langchain/openrouter';
import { HumanMessage } from 'langchain';
import { z } from 'zod';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY env var is required for integration tests');

const IntentSchema = z.object({
  intent: z.enum(['update_cv', 'update_prefs', 'add_insight', 'unknown']),
  preferencesDelta: z.record(z.string(), z.unknown()).optional(),
  insightText: z.string().optional(),
});

const SYSTEM_PROMPT = `
You are a strict intent classifier for a job-search assistant bot.
Classify the user message into ONE of: update_cv, update_prefs, add_insight, unknown.
For update_prefs, extract preferencesDelta with keys: excludedSkills, preferredRoles, remoteOnly, excludedRegions, excludedCompanies.
For add_insight, extract insightText as a concise sentence.
Return ONLY valid JSON matching: { "intent": "...", "preferencesDelta"?: {...}, "insightText"?: "..." }
`.trim();

async function classifyIntent(userMessage: string) {
  const model = new ChatOpenRouter({
    model: 'openai/gpt-4o-mini',
    apiKey: OPENROUTER_API_KEY,
    temperature: 0,
  });
  const result = await model.invoke([
    { role: 'system', content: SYSTEM_PROMPT },
    new HumanMessage(userMessage),
  ]);
  const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  return IntentSchema.parse(json);
}

describe('classifyIntent (integration)', () => {
  it('classifies "no Python jobs" as update_prefs with excludedSkills', async () => {
    const intent = await classifyIntent('no Python jobs please');
    expect(intent.intent).toBe('update_prefs');
    expect(intent.preferencesDelta?.excludedSkills).toContain('Python');
  });

  it('classifies "only remote EU positions" as update_prefs', async () => {
    const intent = await classifyIntent('I only want remote EU positions');
    expect(intent.intent).toBe('update_prefs');
    expect(intent.preferencesDelta?.remoteOnly).toBe(true);
  });

  it('classifies "here is my new cv" as update_cv', async () => {
    const intent = await classifyIntent('here is my new cv');
    expect(intent.intent).toBe('update_cv');
  });

  it('classifies rejection insight as add_insight', async () => {
    const intent = await classifyIntent('Got rejected from Wix — they said I need Java experience');
    expect(intent.intent).toBe('add_insight');
    expect(intent.insightText).toBeTruthy();
    expect(intent.insightText!.toLowerCase()).toContain('wix');
  });

  it('classifies random message as unknown', async () => {
    const intent = await classifyIntent('What is the weather today?');
    expect(intent.intent).toBe('unknown');
  });
});
