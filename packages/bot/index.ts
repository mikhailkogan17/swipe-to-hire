import { bot } from './bot.js';
import { startApi } from './api.js';
import { startScheduler } from './scheduler.js';

console.log('🚀 Starting Swipe To Hire Bot...');

// Start Fastify API (for Mini App)
await startApi();

// Start cron scheduler
startScheduler();

// Start Telegram bot (long polling)
await bot.launch();
console.log('🤖 Bot is running');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
