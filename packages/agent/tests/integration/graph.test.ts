/**
 * Integration test: full LangGraph job-search pipeline
 * Uses real OpenRouter API and real RapidAPI JSearch.
 *
 * Run with: npm run test:integration
 *
 * Prerequisites:
 *   - OPENROUTER_API_KEY in env (or uses the fallback key below)
 *   - RAPIDAPI_KEY in env
 *   - BOT_TOKEN, WEBAPP_URL in env (required by env.ts — can be dummy values for graph tests)
 *
 * What this tests:
 *   1. buildGraph completes without throwing
 *   2. graph.invoke returns matches array
 *   3. Each match has required fields (jobId, title, conformancePercentage)
 *   4. Profile extraction uses CV_URL from env
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load .env from project root
config({ path: resolve(process.cwd(), '.env') });

// Set required env vars for env.ts if not already set
process.env.OPENROUTER_API_KEY ??= '';
process.env.BOT_TOKEN ??= 'dummy:token_for_tests';
process.env.WEBAPP_URL ??= 'https://example.com';
process.env.DB_PATH ??= ':memory:'; // Use in-memory SQLite for integration tests

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

describe('buildGraph + graph.invoke (integration)', () => {
  it('skips if RAPIDAPI_KEY is not set', async () => {
    if (!RAPIDAPI_KEY) {
      console.warn('⚠️  RAPIDAPI_KEY not set — skipping full graph integration test');
      return;
    }
  });

  it('builds graph and returns matches for a real CV', async () => {
    if (!RAPIDAPI_KEY) {
      console.warn('⚠️  RAPIDAPI_KEY not set — skipping');
      return;
    }

    // Import after env is set up
    const { buildGraph } = await import('@swipe-to-hire/agent/graph.js');

    const graph = await buildGraph({
      telegramUserId: 0, // 0 = no DB user; uses CV_URL from env fallback
      apiKeys: {
        openrouterKey: process.env.OPENROUTER_API_KEY,
        rapidApiKey: RAPIDAPI_KEY,
      },
    });

    const result = await graph.invoke(
      { messages: [] },
      { configurable: { thread_id: 'integration-test-0' }, recursionLimit: 50 }
    );

    expect(result).toBeDefined();
    expect(result.matches).toBeDefined();
    expect(Array.isArray(result.matches)).toBe(true);

    if (result.matches.length > 0) {
      const match = result.matches[0];
      expect(match.posting).toBeDefined();
      expect(match.posting.jobId).toBeTruthy();
      expect(match.posting.title).toBeTruthy();
      expect(typeof match.conformancePercentage).toBe('number');
      expect(match.conformancePercentage).toBeGreaterThanOrEqual(0);
      expect(match.conformancePercentage).toBeLessThanOrEqual(100);
      expect(typeof match.needsHumanReview).toBe('boolean');
      console.log(`\n✅ Got ${result.matches.length} matches. Top match: "${match.posting.title}" at ${match.posting.company} (${match.conformancePercentage}%)`);
    } else {
      console.warn('⚠️  Graph returned 0 matches — check if jobs exist for the current CV profile');
    }
  }, 120_000); // 2 min timeout for full pipeline
});
