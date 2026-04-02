import { ChatOpenRouter } from '@langchain/openrouter';
import { HumanMessage } from 'langchain';
import { z } from 'zod';
import { env } from '@swipe-to-hire/agent/env.js';

// Intent schema
const IntentSchema = z.object({
  intent: z.enum(['update_cv', 'update_prefs', 'add_insight', 'unknown']),
  // Extracted payload, depending on intent:
  // update_prefs → preferencesDelta (e.g. "excludedSkills": ["python"])
  // add_insight → insightText (free text to store)
  preferencesDelta: z.record(z.string(), z.unknown()).optional(),
  insightText: z.string().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;

const intentModel = new ChatOpenRouter({
  model: 'openai/gpt-4o-mini',
  apiKey: env.OPENROUTER_API_KEY,
  temperature: 0,
});

const SYSTEM_PROMPT = `
You are a strict intent classifier for a job-search assistant bot.
The user can ONLY update their settings or provide useful job-search insights.
Classify their message into ONE of these intents:

- update_cv: user wants to update or re-upload their CV/resume
- update_prefs: user wants to change search preferences (excluded skills, remote preferences, desired roles, locations, excluded companies, etc.)
- add_insight: user shares any update about their job search (rejection, interview feedback, a company said something, they received an offer, etc.) that would help the agent understand where to focus
- unknown: anything else

For update_prefs, extract a preferencesDelta object with keys like:
  excludedSkills, preferredRoles, remoteOnly, excludedRegions, excludedCompanies
Only include keys that were explicitly mentioned. Use arrays for list values.

For add_insight, extract insightText as a concise single sentence summarizing what happened.

Return ONLY valid JSON matching: { "intent": "...", "preferencesDelta"?: {...}, "insightText"?: "..." }
`.trim();

export async function classifyIntent(userMessage: string): Promise<Intent> {
  try {
    const result = await intentModel.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      new HumanMessage(userMessage),
    ]);
    const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
    return IntentSchema.parse(json);
  } catch (e) {
    console.error('Intent classification failed:', e);
    return { intent: 'unknown' };
  }
}
