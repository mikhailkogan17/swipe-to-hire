/**
 * models.ts — ChatOpenRouter model factory.
 *
 * Create all LLM instances here. Both graphs import from this file.
 * Never instantiate ChatOpenRouter directly in node or graph files.
 */

import { ChatOpenRouter } from '@langchain/openrouter';

export interface ModelOptions {
  apiKey: string;
}

/**
 * Model for CV/profile extraction — needs to follow output schemas strictly.
 * Low temperature for deterministic structured output.
 */
export function makeProfileModel(opts: ModelOptions): ChatOpenRouter {
  return new ChatOpenRouter({
    model: 'openai/gpt-4o',
    apiKey: opts.apiKey,
    temperature: 0.1,
  });
}

/**
 * Model for job search query generation.
 * Low temperature for consistent query planning.
 */
export function makeJobsSearchModel(opts: ModelOptions): ChatOpenRouter {
  return new ChatOpenRouter({
    model: 'openai/gpt-4o',
    apiKey: opts.apiKey,
    temperature: 0.1,
  });
}

/**
 * Model for job filtering.
 * Low temperature for consistent filtering decisions.
 */
export function makeJobsFilterModel(opts: ModelOptions): ChatOpenRouter {
  return new ChatOpenRouter({
    model: 'openai/gpt-4o',
    apiKey: opts.apiKey,
    temperature: 0.1,
  });
}

/**
 * Model for job–profile matching and scoring.
 * Slightly higher temperature for nuanced scoring.
 */
export function makeMatchModel(opts: ModelOptions): ChatOpenRouter {
  return new ChatOpenRouter({
    model: 'openai/gpt-4o',
    apiKey: opts.apiKey,
    temperature: 0.3,
  });
}
