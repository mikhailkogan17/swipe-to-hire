import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from '@swipe-to-hire/agent/env.js';
import {
  getUser,
  updateUserPreferences,
  updateUserSchedule,
  updateUserRegion,
  getUserPreferences,
  getPendingJobs,
  getLikedJobs,
  recordSwipe,
  addInsight,
  getUserInsights,
  markUserOnboarded,
  setUserCvUrl,
  getUserById,
  db,
} from '@swipe-to-hire/agent/db.js';
import { buildProfileSetupGraph } from '@swipe-to-hire/agent/graph.js';
import { runJobSearchForUser } from './scheduler.js';
import { bot, profileReplyWaiters } from './bot.js';

const app = Fastify({ logger: false });

await app.register(cors, {
  origin: true, // In production, restrict to WEBAPP_URL
});

// --- Health ---

app.get('/health', async () => ({ status: 'ok' }));

// --- Profile ---

app.get<{ Params: { telegramUserId: string } }>('/profile/:telegramUserId', async (req, reply) => {
  const telegramUserId = Number(req.params.telegramUserId);
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });

  return {
    id: user.id,
    telegramUserId: user.telegram_user_id,
    profile: user.profile_json ? JSON.parse(user.profile_json) : null,
    preferences: JSON.parse(user.preferences_json),
    scheduleHour: user.schedule_hour,
    region: user.region,
    plan: user.plan,
    onboarded: Boolean(user.onboarded),
  };
});

// --- Onboarding ---

app.post<{
  Body: {
    telegramUserId: number;
    cvUrl?: string;
    preferences?: Record<string, unknown>;
    scheduleHour?: number;
    region?: string;
  };
}>('/onboarding/complete', async (req, reply) => {
  const { telegramUserId, cvUrl, preferences, scheduleHour, region } = req.body;
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });

  if (cvUrl) setUserCvUrl(telegramUserId, cvUrl);
  if (preferences) updateUserPreferences(telegramUserId, preferences);
  if (scheduleHour !== undefined) updateUserSchedule(telegramUserId, scheduleHour);
  if (region) updateUserRegion(telegramUserId, region);
  markUserOnboarded(telegramUserId);

  // Run profile extraction via Telegram HITL (non-blocking background task).
  // After this completes the DB has the profile cached — job-search graph skips extraction.
  const openrouterKey = user.openrouter_api_key ?? env.OPENROUTER_API_KEY;

  const profileGraph = buildProfileSetupGraph({
    telegramUserId,
    sendMessage: async text => {
      await bot.telegram.sendMessage(telegramUserId, text);
    },
    waitForReply: () => new Promise(resolve => profileReplyWaiters.set(telegramUserId, resolve)),
    apiKeys: { openrouterKey },
  });

  // Fire profile setup + job search in background (non-blocking)
  profileGraph
    .invoke({ telegramUserId, openrouterKey, messages: [] })
    .then(() => {
      console.log(`✅ Profile setup completed for user ${telegramUserId}`);
      // Trigger initial job search after profile is ready
      return runJobSearchForUser(telegramUserId, user.id, {
        openrouterKey: user.openrouter_api_key ?? undefined,
        rapidApiKey: user.rapidapi_key ?? undefined,
      });
    })
    .catch((err: unknown) => console.error('Profile setup / initial search failed:', err));

  return { success: true };
});

app.post<{
  Body: { telegramUserId: number };
}>('/onboarding/reset', async (req, reply) => {
  const { telegramUserId } = req.body;
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  db.prepare(`UPDATE users SET onboarded = 0 WHERE telegram_user_id = ?`).run(telegramUserId);
  return { success: true };
});

// --- Preferences ---

app.get<{ Params: { telegramUserId: string } }>(
  '/preferences/:telegramUserId',
  async (req, reply) => {
    const telegramUserId = Number(req.params.telegramUserId);
    const user = getUser(telegramUserId);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return getUserPreferences(telegramUserId);
  }
);

app.patch<{
  Params: { telegramUserId: string };
  Body: Record<string, unknown>;
}>('/preferences/:telegramUserId', async (req, reply) => {
  const telegramUserId = Number(req.params.telegramUserId);
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  const current = getUserPreferences(telegramUserId);
  updateUserPreferences(telegramUserId, { ...current, ...req.body });
  return { success: true };
});

// --- Jobs ---

app.get<{ Params: { telegramUserId: string } }>('/jobs/:telegramUserId', async (req, reply) => {
  const telegramUserId = Number(req.params.telegramUserId);
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  return { jobs: getPendingJobs(user.id) };
});

app.get<{ Params: { telegramUserId: string } }>(
  '/jobs/:telegramUserId/liked',
  async (req, reply) => {
    const telegramUserId = Number(req.params.telegramUserId);
    const user = getUser(telegramUserId);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return { jobs: getLikedJobs(user.id) };
  }
);

// --- Swipe ---

app.post<{
  Body: { telegramUserId: number; jobId: string; action: 'like' | 'dislike' };
}>('/swipe', async (req, reply) => {
  const { telegramUserId, jobId, action } = req.body;
  if (!['like', 'dislike'].includes(action)) {
    return reply.status(400).send({ error: 'action must be like or dislike' });
  }
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  recordSwipe(user.id, jobId, action);
  return { success: true };
});

// --- Insights ---

app.post<{
  Body: { telegramUserId: number; content: string };
}>('/insights', async (req, reply) => {
  const { telegramUserId, content } = req.body;
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  addInsight(user.id, content);
  return { success: true };
});

app.get<{ Params: { telegramUserId: string } }>('/insights/:telegramUserId', async (req, reply) => {
  const telegramUserId = Number(req.params.telegramUserId);
  const user = getUser(telegramUserId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  return { insights: getUserInsights(user.id) };
});

// --- Start ---

export async function startApi(): Promise<void> {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  console.log(`🌐 API listening on port ${env.API_PORT}`);
}
