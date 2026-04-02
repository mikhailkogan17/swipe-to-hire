/**
 * Unit tests for mergePreferences logic (from bot.ts)
 * Tested in isolation — no Telegram or DB dependency.
 */
import { describe, it, expect } from 'vitest';

// Extracted from bot.ts for isolated testing
function mergePreferences(
  current: Record<string, unknown>,
  delta: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    if (Array.isArray(value) && Array.isArray(result[key])) {
      result[key] = [...new Set([...(result[key] as unknown[]), ...value])];
    } else {
      result[key] = value;
    }
  }
  return result;
}

describe('mergePreferences', () => {
  it('merges new keys into empty preferences', () => {
    const result = mergePreferences({}, { excludedSkills: ['Python'] });
    expect(result.excludedSkills).toEqual(['Python']);
  });

  it('deduplicates array values', () => {
    const result = mergePreferences(
      { excludedSkills: ['Python', 'Java'] },
      { excludedSkills: ['Python', 'PHP'] }
    );
    expect(result.excludedSkills).toEqual(['Python', 'Java', 'PHP']);
  });

  it('overwrites scalar values', () => {
    const result = mergePreferences({ remoteOnly: false }, { remoteOnly: true });
    expect(result.remoteOnly).toBe(true);
  });

  it('preserves keys not in delta', () => {
    const result = mergePreferences(
      { excludedSkills: ['Python'], remoteOnly: true },
      { preferredRoles: ['DevOps'] }
    );
    expect(result.excludedSkills).toEqual(['Python']);
    expect(result.remoteOnly).toBe(true);
    expect(result.preferredRoles).toEqual(['DevOps']);
  });

  it('handles empty delta', () => {
    const prefs = { excludedSkills: ['Python'] };
    const result = mergePreferences(prefs, {});
    expect(result).toEqual(prefs);
  });
});
