import type { Job, JobMatch, UserProfile, OnboardingRequest, SwipeAction } from '@swipe-to-hire/types';
export type { Job, JobMatch, UserProfile };

const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '/api' : 'http://localhost:3421');

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  getProfile: (telegramUserId: number) => req<UserProfile>(`/profile/${telegramUserId}`),

  completeOnboarding: (body: OnboardingRequest) =>
    req<{ success: boolean }>('/onboarding/complete', { method: 'POST', body: JSON.stringify(body) }),

  resetOnboarding: (telegramUserId: number) =>
    req<{ success: boolean }>('/onboarding/reset', { method: 'POST', body: JSON.stringify({ telegramUserId }) }),

  getJobs: (telegramUserId: number) => req<{ jobs: JobMatch[] }>(`/jobs/${telegramUserId}`),
  getLikedJobs: (telegramUserId: number) => req<{ jobs: JobMatch[] }>(`/jobs/${telegramUserId}/liked`),

  swipe: (telegramUserId: number, jobId: string, action: SwipeAction) =>
    req<{ success: boolean }>('/swipe', { method: 'POST', body: JSON.stringify({ telegramUserId, jobId, action }) }),

  updatePreferences: (telegramUserId: number, prefs: Record<string, unknown>) =>
    req<{ success: boolean }>(`/preferences/${telegramUserId}`, { method: 'PATCH', body: JSON.stringify(prefs) }),

  addInsight: (telegramUserId: number, content: string) =>
    req<{ success: boolean }>('/insights', { method: 'POST', body: JSON.stringify({ telegramUserId, content }) }),
};
