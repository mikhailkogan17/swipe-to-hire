import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { env } from './env.js';

export const db: BetterSqlite3.Database = new Database(resolve(process.cwd(), env.DB_PATH));

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id    INTEGER UNIQUE NOT NULL,
    cv_url              TEXT,
    cv_hash             TEXT,
    profile_json        TEXT,
    preferences_json    TEXT NOT NULL DEFAULT '{}',
    schedule_hour       INTEGER NOT NULL DEFAULT 9,
    region              TEXT NOT NULL DEFAULT 'global',
    openrouter_api_key  TEXT,
    rapidapi_key        TEXT,
    plan                TEXT NOT NULL DEFAULT 'free',
    onboarded           INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS insights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    data_json   TEXT NOT NULL,
    found_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(job_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS swipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    job_id      TEXT NOT NULL,
    action      TEXT NOT NULL CHECK(action IN ('like', 'dislike')),
    swiped_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, job_id)
  );

  CREATE TABLE IF NOT EXISTS additional_info (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    field       TEXT NOT NULL,
    answer      TEXT NOT NULL,
    cv_hash     TEXT NOT NULL,
    answered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Types ---

export interface UserRow {
  id: number;
  telegram_user_id: number;
  cv_url: string | null;
  cv_hash: string | null;
  profile_json: string | null;
  preferences_json: string;
  schedule_hour: number;
  region: string;
  openrouter_api_key: string | null;
  rapidapi_key: string | null;
  plan: string;
  onboarded: number;
  created_at: string;
}

export interface UserPreferences {
  excludedSkills?: string[];
  excludedCompanies?: string[]
  preferredRoles?: string[];
  remoteOnly?: boolean;
  excludedRegions?: string[];
  [key: string]: unknown;
}

// --- Users ---

export function upsertUser(telegramUserId: number): UserRow {
  db.prepare(`
    INSERT INTO users (telegram_user_id) VALUES (?)
    ON CONFLICT(telegram_user_id) DO NOTHING
  `).run(telegramUserId);
  return db.prepare(`SELECT * FROM users WHERE telegram_user_id = ?`).get(telegramUserId) as UserRow;
}

export function getUser(telegramUserId: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE telegram_user_id = ?`).get(telegramUserId) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function getAllUsers(): UserRow[] {
  return db.prepare(`SELECT * FROM users WHERE onboarded = 1`).all() as UserRow[];
}

export function updateUserProfile(telegramUserId: number, cvHash: string, cvUrl: string, profileJson: string): void {
  db.prepare(`
    UPDATE users SET cv_hash = ?, cv_url = ?, profile_json = ? WHERE telegram_user_id = ?
  `).run(cvHash, cvUrl, profileJson, telegramUserId);
}

export function updateUserPreferences(telegramUserId: number, prefs: UserPreferences): void {
  db.prepare(`UPDATE users SET preferences_json = ? WHERE telegram_user_id = ?`)
    .run(JSON.stringify(prefs), telegramUserId);
}

export function updateUserSchedule(telegramUserId: number, hour: number): void {
  db.prepare(`UPDATE users SET schedule_hour = ? WHERE telegram_user_id = ?`).run(hour, telegramUserId);
}

export function updateUserRegion(telegramUserId: number, region: string): void {
  db.prepare(`UPDATE users SET region = ? WHERE telegram_user_id = ?`).run(region, telegramUserId);
}

export function markUserOnboarded(telegramUserId: number): void {
  db.prepare(`UPDATE users SET onboarded = 1 WHERE telegram_user_id = ?`).run(telegramUserId);
}

export function setUserCvUrl(telegramUserId: number, cvUrl: string): void {
  db.prepare(`UPDATE users SET cv_url = ? WHERE telegram_user_id = ?`).run(cvUrl, telegramUserId);
}

export function getUserPreferences(telegramUserId: number): UserPreferences {
  const user = getUser(telegramUserId);
  if (!user) return {};
  try {
    return JSON.parse(user.preferences_json) as UserPreferences;
  } catch {
    return {};
  }
}

// --- Insights ---

export function addInsight(userId: number, content: string): void {
  db.prepare(`INSERT INTO insights (user_id, content) VALUES (?, ?)`).run(userId, content);
}

export function getUserInsights(userId: number): string[] {
  const rows = db.prepare(`
    SELECT content FROM insights WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(userId) as { content: string }[];
  return rows.map(r => r.content);
}

// --- Jobs ---

export function saveJobs(userId: number, jobs: object[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO jobs (job_id, user_id, data_json)
    VALUES (@jobId, @userId, @dataJson)
  `);
  const insertMany = db.transaction((items: object[]) => {
    for (const job of items as Array<{ jobId: string }>) {
      stmt.run({ jobId: (job as any).jobId, userId, dataJson: JSON.stringify(job) });
    }
  });
  insertMany(jobs);
}

export function getPendingJobs(userId: number): object[] {
  const rows = db.prepare(`
    SELECT j.data_json FROM jobs j
    LEFT JOIN swipes s ON s.job_id = j.job_id AND s.user_id = j.user_id
    WHERE j.user_id = ? AND s.id IS NULL
    ORDER BY j.found_at DESC
  `).all(userId) as { data_json: string }[];
  return rows.map(r => JSON.parse(r.data_json));
}

export function getSentJobIds(userId: number): string[] {
  const rows = db.prepare(`SELECT job_id FROM jobs WHERE user_id = ?`).all(userId) as { job_id: string }[];
  return rows.map(r => r.job_id);
}

// --- Swipes ---

export function recordSwipe(userId: number, jobId: string, action: 'like' | 'dislike'): void {
  db.prepare(`
    INSERT OR REPLACE INTO swipes (user_id, job_id, action) VALUES (?, ?, ?)
  `).run(userId, jobId, action);
}

export function getLikedJobs(userId: number): object[] {
  const rows = db.prepare(`
    SELECT j.data_json FROM swipes s
    JOIN jobs j ON j.job_id = s.job_id AND j.user_id = s.user_id
    WHERE s.user_id = ? AND s.action = 'like'
    ORDER BY s.swiped_at DESC
  `).all(userId) as { data_json: string }[];
  return rows.map(r => JSON.parse(r.data_json));
}

// --- Additional Info (for profileExtractor interrupt flow) ---

export interface AdditionalInfoRow {
  field: string;
  answer: string;
  cv_hash: string;
  answered_at: string;
}

export function addAdditionalInfoForUser(userId: number, field: string, answer: string, cvHash: string): void {
  db.prepare(`
    INSERT INTO additional_info (user_id, field, answer, cv_hash) VALUES (?, ?, ?, ?)
  `).run(userId, field, answer, cvHash);
}

export function getAdditionalInfoForUser(userId: number): AdditionalInfoRow[] {
  return db.prepare(`
    SELECT field, answer, cv_hash, answered_at FROM additional_info WHERE user_id = ?
    ORDER BY answered_at DESC
  `).all(userId) as AdditionalInfoRow[];
}

// --- Profile cache (stored in users table) ---

export function hashCV(cvContent: string): string {
  return createHash('sha256').update(cvContent).digest('hex');
}

export interface ProfileCache {
  cvHash: string;
  profile: Record<string, unknown>;
  updatedAt: string;
}

export function getProfileCache(telegramUserId: number): ProfileCache | undefined {
  const user = getUser(telegramUserId);
  if (!user?.profile_json || !user?.cv_hash) return undefined;
  try {
    return {
      cvHash: user.cv_hash,
      profile: JSON.parse(user.profile_json),
      updatedAt: user.created_at,
    };
  } catch {
    return undefined;
  }
}

export function saveProfileCache(telegramUserId: number, cvHash: string, cvUrl: string, profile: Record<string, unknown>): void {
  db.prepare(`
    UPDATE users SET cv_hash = ?, cv_url = ?, profile_json = ? WHERE telegram_user_id = ?
  `).run(cvHash, cvUrl, JSON.stringify(profile), telegramUserId);
}
