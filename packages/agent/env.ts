import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  // Default API keys (fallback; users can override with their own BYOK keys in DB)
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  RAPIDAPI_KEY: z.string().min(1, "RAPIDAPI_KEY is required"),
  // CV_URL is now stored per-user in DB; keep for local/CLI usage
  CV_URL: z.url("CV_URL must be a valid URL").optional(),
  // Telegram bot
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  // Mini App URL (deployed URL of the miniapp/ frontend)
  WEBAPP_URL: z.string().url("WEBAPP_URL must be a valid URL"),
  // SQLite DB file path
  DB_PATH: z.string().default('.swipe-to-hire.db'),
  // API port
  API_PORT: z.coerce.number().default(3421),
  // Telegram user ID — used by CLI to run graph as a specific user (dev only)
  USER_ID: z.coerce.number().optional(),
});

export const env = EnvSchema.parse(process.env);
