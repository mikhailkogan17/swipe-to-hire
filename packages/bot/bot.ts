import { Telegraf, Markup, Context } from 'telegraf';
import { env } from '@swipe-to-hire/agent/env.js';
import {
  upsertUser,
  getUser,
  updateUserPreferences,
  getUserPreferences,
  addInsight,
  setUserCvUrl,
  markUserOnboarded,
} from '@swipe-to-hire/agent/db.js';
import { classifyIntent } from './intentHandler.js';

export const bot = new Telegraf(env.BOT_TOKEN);

// --- Profile-setup HITL reply waiters ---
// Maps telegramUserId → resolve function of a pending Promise<string>.
// Used by buildProfileGraph to wait for user's answer to a clarification question.
//
// TODO(user): Wire this map into the onboarding flow:
//   1. In /onboarding/complete handler (api.ts), pass:
//        sendMessage: (text) => bot.telegram.sendMessage(telegramUserId, text)
//        waitForReply: () => new Promise(resolve => profileReplyWaiters.set(telegramUserId, resolve))
//      to buildProfileGraph() BEFORE calling runJobSearchForUser.
//   2. In bot.on('text') handler below, BEFORE classifyIntent, add:
//        const waiter = profileReplyWaiters.get(telegramUserId)
//        if (waiter) {
//          profileReplyWaiters.delete(telegramUserId)
//          waiter(text)
//          return
//        }
//   This routes the user's reply directly to the waiting graph node.
export const profileReplyWaiters = new Map<number, (reply: string) => void>();

// --- Pending state per chat (for multi-step flows) ---
// Simple in-memory map: telegramUserId → what we're waiting for
type PendingState = 'awaiting_cv';
const pendingStates = new Map<number, PendingState>();

// --- /start ---

bot.command('start', async (ctx) => {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const user = upsertUser(telegramUserId);

  if (!user.onboarded) {
    await ctx.reply(
      '👋 Welcome to *Swipe To Hire* — your personal AI headhunter\\!\n\n' +
      'I search and score job postings daily based on your profile\\.\n\n' +
      'Let\'s get you set up — tap the button below to start onboarding:',
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          Markup.button.webApp('🚀 Start Onboarding', `${env.WEBAPP_URL}/onboarding`),
        ]),
      }
    );
  } else {
    await ctx.reply(
      '👋 Welcome back\\! Your job search is running\\.',
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('📋 View Jobs', `${env.WEBAPP_URL}`)],
          [Markup.button.webApp('⚙️ Settings', `${env.WEBAPP_URL}/settings`)],
        ]),
      }
    );
  }
});

// --- /help ---

bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 *What I can do:*\n\n' +
    '• Update your CV: _"here is my new cv"_ or send a link/file\n' +
    '• Update preferences: _"no Python jobs"_, _"only remote EU"_\n' +
    '• Log insights: _"got a rejection from Wix because they need Java"_\n\n' +
    'For everything else, use the app:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.webApp('📋 Open App', env.WEBAPP_URL),
      ]),
    }
  );
});

// --- /status ---

bot.command('status', async (ctx) => {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;
  const user = getUser(telegramUserId);
  if (!user || !user.onboarded) {
    await ctx.reply('You haven\'t completed onboarding yet. Use /start');
    return;
  }
  const prefs = getUserPreferences(telegramUserId);
  const prefsText = Object.keys(prefs).length
    ? JSON.stringify(prefs, null, 2)
    : 'Default (no overrides)';
  await ctx.reply(
    `📊 *Your Status*\n\n` +
    `🕐 Daily update: *${user.schedule_hour}:00*\n` +
    `🌍 Region: *${user.region}*\n` +
    `⚙️ Preferences:\n\`\`\`\n${prefsText}\n\`\`\``,
    { parse_mode: 'Markdown' }
  );
});

// --- Document / photo handler (CV upload) ---

bot.on('document', async (ctx) => {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  if (pendingStates.get(telegramUserId) === 'awaiting_cv') {
    // User sent a file as CV
    const fileId = ctx.message.document.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const cvUrl = fileLink.href;

    const user = getUser(telegramUserId);
    if (!user) { await ctx.reply('Please /start first.'); return; }

    setUserCvUrl(telegramUserId, cvUrl);
    pendingStates.delete(telegramUserId);

    await ctx.reply(
      '✅ Got your CV! Starting profile extraction — this takes ~30 seconds.\n\n' +
      'I\'ll notify you when it\'s ready.'
    );

    // Trigger profile extraction in background (non-blocking)
    import('@swipe-to-hire/agent/graph.js')
      .then(({ buildGraph }) => buildGraph({
        telegramUserId,
        apiKeys: {
          openrouterKey: user.openrouter_api_key ?? undefined,
          rapidApiKey: user.rapidapi_key ?? undefined,
        }
      }))
      .then(graph => graph.invoke(
        { messages: [] },
        { configurable: { thread_id: String(telegramUserId) }, recursionLimit: 50 }
      ))
      .then(async () => {
        if (!user.onboarded) {
          markUserOnboarded(telegramUserId);
        }
        await bot.telegram.sendMessage(
          telegramUserId,
          '✅ Profile extracted! Your job search will start at your scheduled time.\n\nOpen the app to check your settings:',
          Markup.inlineKeyboard([Markup.button.webApp('📋 Open App', env.WEBAPP_URL)])
        );
      })
      .catch(async (err) => {
        console.error('Profile extraction failed for user', telegramUserId, err);
        await bot.telegram.sendMessage(telegramUserId, '❌ Profile extraction failed. Please try again or contact support.');
      });

    return;
  }

  // Otherwise, treat as unsolicited document → intent flow
  await handleTextIntent(ctx, 'new cv uploaded');
});

// --- Text message handler ---

bot.on('text', async (ctx) => {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const text = ctx.message.text;
  if (text.startsWith('/')) return; // handled by commands

  await handleTextIntent(ctx, text);
});

// --- Intent handler ---

async function handleTextIntent(ctx: Context, text: string) {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const user = getUser(telegramUserId);
  if (!user) { await ctx.reply('Please use /start first.'); return; }

  const waitMsg = await ctx.reply('🤔 Processing...');

  const intent = await classifyIntent(text);

  // Delete the "Processing..." message
  await ctx.telegram.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

  switch (intent.intent) {
    case 'update_cv': {
      pendingStates.set(telegramUserId, 'awaiting_cv');
      await ctx.reply(
        '📎 Sure! Please send me your CV as a file, or paste a link to your online CV/portfolio:'
      );
      break;
    }

    case 'update_prefs': {
      if (!intent.preferencesDelta || Object.keys(intent.preferencesDelta).length === 0) {
        await ctx.reply('I understood you want to update preferences, but couldn\'t extract what to change. Could you be more specific?');
        break;
      }
      const current = getUserPreferences(telegramUserId);
      const merged = mergePreferences(current, intent.preferencesDelta as Record<string, unknown>);
      updateUserPreferences(telegramUserId, merged);
      await ctx.reply(
        `✅ Preferences updated! Here's what changed:\n\`\`\`json\n${JSON.stringify(intent.preferencesDelta, null, 2)}\n\`\`\`\nThis will take effect on your next job search.`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'add_insight': {
      const insightText = intent.insightText ?? text;
      addInsight(user.id, insightText);
      await ctx.reply(
        `💡 Got it! I've noted: _"${insightText}"_\n\nThis will help me focus your next search.`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'unknown':
    default: {
      await ctx.reply(
        '❓ I can only help you update your settings. Try:\n' +
        '• _"no Python jobs"_\n' +
        '• _"only remote EU positions"_\n' +
        '• _"update my CV"_\n' +
        '• _"got rejected from Wix, they need Java"_\n\n' +
        'For everything else, use /help',
        { parse_mode: 'Markdown' }
      );
      break;
    }
  }
}

// --- Helpers ---

function mergePreferences(
  current: Record<string, unknown>,
  delta: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    if (Array.isArray(value) && Array.isArray(result[key])) {
      // Merge arrays (deduplicate)
      result[key] = [...new Set([...(result[key] as unknown[]), ...value])];
    } else {
      result[key] = value;
    }
  }
  return result;
}

// --- Notification helpers (called from scheduler) ---

export async function notifyJobsReady(telegramUserId: number, count: number): Promise<void> {
  await bot.telegram.sendMessage(
    telegramUserId,
    `🔥 *${count} new position${count !== 1 ? 's' : ''} matched your profile\\!*\n\nTap below to review them:`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        Markup.button.webApp('👆 Review Jobs', env.WEBAPP_URL),
      ]),
    }
  );
}

export async function notifyNoJobs(telegramUserId: number): Promise<void> {
  await bot.telegram.sendMessage(
    telegramUserId,
    `🔍 Done searching — no new matching positions today\\. I\'ll keep looking tomorrow\\!`,
    { parse_mode: 'MarkdownV2' }
  );
}
