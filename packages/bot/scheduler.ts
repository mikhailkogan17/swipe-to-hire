import cron from 'node-cron';
import { getAllUsers, saveJobs } from '@swipe-to-hire/agent/db.js';
import { notifyJobsReady, notifyNoJobs } from './bot.js';
import { buildGraph } from '@swipe-to-hire/agent/graph.js';
import { env } from '@swipe-to-hire/agent/env.js';

// Run every hour — check which users have their schedule_hour matching current UTC hour
export function startScheduler(): void {
  cron.schedule('0 * * * *', async () => {
    const currentHour = new Date().getUTCHours();
    const users = getAllUsers().filter(u => u.schedule_hour === currentHour);

    if (users.length === 0) return;
    console.log(`⏰ Scheduler: running for ${users.length} user(s) at UTC hour ${currentHour}`);

    for (const user of users) {
      await runJobSearchForUser(user.telegram_user_id, user.id, {
        openrouterKey: user.openrouter_api_key ?? undefined,
        rapidApiKey: user.rapidapi_key ?? undefined,
      });
    }
  });

  console.log('⏰ Scheduler started (checks every hour)');
}

export async function runJobSearchForUser(
  telegramUserId: number,
  userId: number,
  apiKeys?: { openrouterKey?: string; rapidApiKey?: string }
): Promise<void> {
  console.log(`🔍 Starting job search for user ${telegramUserId}...`);

  const openrouterKey = apiKeys?.openrouterKey ?? env.OPENROUTER_API_KEY;
  const rapidApiKey = apiKeys?.rapidApiKey ?? env.RAPIDAPI_KEY;

  try {
    const graph = await buildGraph({ telegramUserId, apiKeys });
    const result = await graph.invoke(
      { telegramUserId, openrouterKey, rapidApiKey, messages: [] },
      { configurable: { thread_id: String(telegramUserId) }, recursionLimit: 50 }
    );

    const matches = result.matches ?? [];
    if (matches.length > 0) {
      // Save full Match objects so SwipePage gets conformancePercentage, agentNotes, needsHumanReview
      // Each match has: { posting: JobPosting, conformancePercentage, agentNotes, needsHumanReview }
      // db.saveJobs expects objects with a top-level `jobId` field for dedup — wrap accordingly
      const jobsToSave = matches.map((m: any) => ({
        jobId: m.posting.jobId,
        ...m.posting,
        conformancePercentage: m.conformancePercentage,
        agentNotes: m.agentNotes,
        needsHumanReview: m.needsHumanReview,
      }));
      saveJobs(userId, jobsToSave);
      await notifyJobsReady(telegramUserId, matches.length);
      console.log(`✅ Job search for user ${telegramUserId}: ${matches.length} matches saved`);
    } else {
      await notifyNoJobs(telegramUserId);
      console.log(`⚠️ Job search for user ${telegramUserId}: no matches`);
    }
  } catch (err) {
    console.error(`❌ Job search failed for user ${telegramUserId}:`, err);
  }
}
