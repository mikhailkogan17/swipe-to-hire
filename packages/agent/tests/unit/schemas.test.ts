/**
 * Unit tests for Zod schemas in graph.ts
 * Validates that the schema definitions are correct and match expected shapes.
 */
import { describe, it, expect } from 'vitest';
import {
  MissingInfo,
  CandidateProfile,
  ProfileExtractionResult,
  SearchQuery,
  BuildGraphOptions,
} from '../../graph.js';

describe('MissingInfo schema', () => {
  it('validates valid missing info', () => {
    const result = MissingInfo.safeParse({
      fields: ['email', 'phone'],
      question: 'What is your email?',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty fields array', () => {
    const result = MissingInfo.safeParse({ fields: [], question: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects missing question', () => {
    const result = MissingInfo.safeParse({ fields: ['email'], question: '' });
    expect(result.success).toBe(false);
  });
});

describe('CandidateProfile schema', () => {
  const validProfile = {
    name: 'Mikhail Kogan',
    preferredRole: 'Platform Engineer',
    summary: 'iOS developer transitioning to DevOps',
    skills: ['Swift', 'CI/CD', 'Fastlane'],
    yearsOfExperience: 8,
    targetRole: 'DevOps Engineer',
    experience: [
      {
        company: 'Tinkoff',
        role: 'iOS Team Lead',
        period: '2021-2023',
        achievements: ['Led team of 13'],
      },
    ],
    location: 'Tel Aviv',
    links: [],
    languages: ['Russian', 'English'],
  };

  it('validates a complete profile', () => {
    const result = CandidateProfile.safeParse(validProfile);
    expect(result.success).toBe(true);
  });

  it('rejects profile with negative yearsOfExperience', () => {
    const result = CandidateProfile.safeParse({ ...validProfile, yearsOfExperience: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts profile without optional fields', () => {
    const { email, phone, currentRole, ...minimal } = validProfile as any;
    const result = CandidateProfile.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('defaults links and languages to empty arrays', () => {
    const { links, languages, ...rest } = validProfile as any;
    const result = CandidateProfile.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.links).toEqual([]);
      expect(result.data.languages).toEqual([]);
    }
  });
});

describe('ProfileExtractionResult discriminated union', () => {
  it('accepts success status', () => {
    const validProfile = {
      name: 'Test',
      preferredRole: 'Eng',
      summary: 'S',
      skills: [],
      yearsOfExperience: 1,
      targetRole: 'SWE',
      experience: [],
      location: 'IL',
    };
    const result = ProfileExtractionResult.safeParse({ status: 'success', profile: validProfile });
    expect(result.success).toBe(true);
  });

  it('accepts missingInfo status', () => {
    const result = ProfileExtractionResult.safeParse({
      status: 'missingInfo',
      missingInfo: { fields: ['email'], question: 'What is your email?' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts needsHumanReview status', () => {
    const validProfile = {
      name: 'Test', preferredRole: 'Eng', summary: 'S', skills: [],
      yearsOfExperience: 1, targetRole: 'SWE', experience: [], location: 'IL',
    };
    const result = ProfileExtractionResult.safeParse({
      status: 'needsHumanReview',
      humanReview: { question: 'Is this correct?', profile: validProfile },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown status', () => {
    const result = ProfileExtractionResult.safeParse({ status: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('SearchQuery schema', () => {
  it('validates basic query', () => {
    const result = SearchQuery.safeParse({ query: 'LangGraph engineer' });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = SearchQuery.safeParse({
      query: 'DevOps Israel',
      country: 'il',
      work_from_home: true,
      num_pages: 2,
    });
    expect(result.success).toBe(true);
  });

  it('defaults num_pages to 1', () => {
    const result = SearchQuery.safeParse({ query: 'test' });
    if (result.success) {
      expect(result.data.num_pages).toBe(1);
    }
  });
});
