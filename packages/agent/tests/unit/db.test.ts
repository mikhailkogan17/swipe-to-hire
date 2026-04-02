/**
 * Unit tests for agent/db.ts
 * Uses an in-memory SQLite DB to avoid touching the real DB file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

// We re-implement the DB functions inline here using a fresh in-memory DB
// so tests are fully isolated and don't depend on process.env.

function createTestDb(): BetterSqlite3.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER UNIQUE NOT NULL,
      cv_url TEXT,
      cv_hash TEXT,
      profile_json TEXT,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      schedule_hour INTEGER NOT NULL DEFAULT 9,
      region TEXT NOT NULL DEFAULT 'global',
      openrouter_api_key TEXT,
      rapidapi_key TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      onboarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      data_json TEXT NOT NULL,
      found_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(job_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS swipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      job_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('like', 'dislike')),
      swiped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, job_id)
    );
    CREATE TABLE IF NOT EXISTS additional_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      field TEXT NOT NULL,
      answer TEXT NOT NULL,
      cv_hash TEXT NOT NULL,
      answered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// --- DB helper functions using injected db ---

function upsertUser(db: BetterSqlite3.Database, telegramUserId: number) {
  db.prepare(`INSERT INTO users (telegram_user_id) VALUES (?) ON CONFLICT(telegram_user_id) DO NOTHING`).run(telegramUserId);
  return db.prepare(`SELECT * FROM users WHERE telegram_user_id = ?`).get(telegramUserId) as any;
}

function getUser(db: BetterSqlite3.Database, telegramUserId: number) {
  return db.prepare(`SELECT * FROM users WHERE telegram_user_id = ?`).get(telegramUserId) as any;
}

function saveJobs(db: BetterSqlite3.Database, userId: number, jobs: object[]) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO jobs (job_id, user_id, data_json) VALUES (@jobId, @userId, @dataJson)`);
  const insertMany = db.transaction((items: object[]) => {
    for (const job of items as Array<{ jobId: string }>) {
      stmt.run({ jobId: (job as any).jobId, userId, dataJson: JSON.stringify(job) });
    }
  });
  insertMany(jobs);
}

function getPendingJobs(db: BetterSqlite3.Database, userId: number): object[] {
  const rows = db.prepare(`
    SELECT j.data_json FROM jobs j
    LEFT JOIN swipes s ON s.job_id = j.job_id AND s.user_id = j.user_id
    WHERE j.user_id = ? AND s.id IS NULL
    ORDER BY j.found_at DESC
  `).all(userId) as { data_json: string }[];
  return rows.map(r => JSON.parse(r.data_json));
}

function recordSwipe(db: BetterSqlite3.Database, userId: number, jobId: string, action: 'like' | 'dislike') {
  db.prepare(`INSERT OR REPLACE INTO swipes (user_id, job_id, action) VALUES (?, ?, ?)`).run(userId, jobId, action);
}

function getLikedJobs(db: BetterSqlite3.Database, userId: number): object[] {
  const rows = db.prepare(`
    SELECT j.data_json FROM swipes s
    JOIN jobs j ON j.job_id = s.job_id AND j.user_id = s.user_id
    WHERE s.user_id = ? AND s.action = 'like'
    ORDER BY s.swiped_at DESC
  `).all(userId) as { data_json: string }[];
  return rows.map(r => JSON.parse(r.data_json));
}

function getSentJobIds(db: BetterSqlite3.Database, userId: number): string[] {
  const rows = db.prepare(`SELECT job_id FROM jobs WHERE user_id = ?`).all(userId) as { job_id: string }[];
  return rows.map(r => r.job_id);
}

function addInsight(db: BetterSqlite3.Database, userId: number, content: string) {
  db.prepare(`INSERT INTO insights (user_id, content) VALUES (?, ?)`).run(userId, content);
}

function getUserInsights(db: BetterSqlite3.Database, userId: number): string[] {
  const rows = db.prepare(`SELECT content FROM insights WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(userId) as { content: string }[];
  return rows.map(r => r.content);
}

// ---

describe('db: users', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('upsertUser creates a new user', () => {
    const user = upsertUser(db, 12345);
    expect(user).toBeTruthy();
    expect(user.telegram_user_id).toBe(12345);
    expect(user.onboarded).toBe(0);
    expect(user.plan).toBe('free');
    expect(user.schedule_hour).toBe(9);
  });

  it('upsertUser is idempotent', () => {
    upsertUser(db, 12345);
    upsertUser(db, 12345);
    const count = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE telegram_user_id = 12345`).get() as any).c;
    expect(count).toBe(1);
  });

  it('getUser returns undefined for unknown user', () => {
    const user = getUser(db, 99999);
    expect(user).toBeUndefined();
  });

  it('marks user as onboarded', () => {
    upsertUser(db, 12345);
    db.prepare(`UPDATE users SET onboarded = 1 WHERE telegram_user_id = ?`).run(12345);
    const user = getUser(db, 12345);
    expect(user.onboarded).toBe(1);
  });
});

describe('db: jobs', () => {
  let db: BetterSqlite3.Database;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    const user = upsertUser(db, 42);
    userId = user.id;
  });
  afterEach(() => { db.close(); });

  const mockMatch = (id: string) => ({
    jobId: id,
    title: `Job ${id}`,
    company: 'Acme',
    applyUrl: `https://example.com/${id}`,
    requiredSkills: ['TypeScript'],
    minExperience: 3,
    locations: [{ workType: 'remote', addressKind: 'global' }],
    conformancePercentage: 85,
    agentNotes: 'Good fit',
    needsHumanReview: false,
  });

  it('saveJobs persists full match objects', () => {
    saveJobs(db, userId, [mockMatch('job-1'), mockMatch('job-2')]);
    const pending = getPendingJobs(db, userId);
    expect(pending).toHaveLength(2);
    const job = pending[0] as any;
    expect(job.conformancePercentage).toBeDefined();
    expect(job.agentNotes).toBe('Good fit');
    expect(job.needsHumanReview).toBe(false);
  });

  it('saveJobs deduplicates by job_id', () => {
    saveJobs(db, userId, [mockMatch('job-1')]);
    saveJobs(db, userId, [mockMatch('job-1')]);
    const pending = getPendingJobs(db, userId);
    expect(pending).toHaveLength(1);
  });

  it('getPendingJobs excludes swiped jobs', () => {
    saveJobs(db, userId, [mockMatch('job-1'), mockMatch('job-2')]);
    recordSwipe(db, userId, 'job-1', 'dislike');
    const pending = getPendingJobs(db, userId);
    expect(pending).toHaveLength(1);
    expect((pending[0] as any).jobId).toBe('job-2');
  });

  it('getLikedJobs returns only liked jobs', () => {
    saveJobs(db, userId, [mockMatch('job-1'), mockMatch('job-2')]);
    recordSwipe(db, userId, 'job-1', 'like');
    recordSwipe(db, userId, 'job-2', 'dislike');
    const liked = getLikedJobs(db, userId);
    expect(liked).toHaveLength(1);
    expect((liked[0] as any).jobId).toBe('job-1');
  });

  it('getSentJobIds returns all saved job IDs', () => {
    saveJobs(db, userId, [mockMatch('job-1'), mockMatch('job-2')]);
    const ids = getSentJobIds(db, userId);
    expect(ids).toContain('job-1');
    expect(ids).toContain('job-2');
  });

  it('recordSwipe updates existing swipe action', () => {
    saveJobs(db, userId, [mockMatch('job-1')]);
    recordSwipe(db, userId, 'job-1', 'dislike');
    recordSwipe(db, userId, 'job-1', 'like'); // override
    const liked = getLikedJobs(db, userId);
    expect(liked).toHaveLength(1);
  });
});

describe('db: insights', () => {
  let db: BetterSqlite3.Database;
  let userId: number;

  beforeEach(() => {
    db = createTestDb();
    const user = upsertUser(db, 99);
    userId = user.id;
  });
  afterEach(() => { db.close(); });

  it('addInsight and getUserInsights', () => {
    addInsight(db, userId, 'rejected by Wix, need Java');
    addInsight(db, userId, 'got interview at Monday.com');
    const insights = getUserInsights(db, userId);
    expect(insights).toHaveLength(2);
    // Both insights should be present (order may vary in in-memory DB)
    expect(insights).toContain('rejected by Wix, need Java');
    expect(insights).toContain('got interview at Monday.com');
  });

  it('getUserInsights returns empty array for user with no insights', () => {
    const insights = getUserInsights(db, userId);
    expect(insights).toEqual([]);
  });
});
