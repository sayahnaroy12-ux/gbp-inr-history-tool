import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DEFAULT_DATABASE_PATH = resolve('data/gbp-inr.sqlite');

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function openRateDatabase(path = process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_rates (
      date TEXT PRIMARY KEY NOT NULL,
      rate REAL NOT NULL CHECK (rate > 0),
      source TEXT NOT NULL DEFAULT 'Frankfurter / ECB',
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function upsertRates(db, rates, fetchedAt = new Date().toISOString()) {
  const insert = db.prepare(`
    INSERT INTO daily_rates (date, rate, source, fetched_at)
    VALUES (@date, @rate, 'Frankfurter / ECB', @fetchedAt)
    ON CONFLICT(date) DO UPDATE SET
      rate = excluded.rate,
      source = excluded.source,
      fetched_at = excluded.fetched_at
  `);
  const write = db.transaction((items) => {
    let changes = 0;
    for (const { date, rate } of items) {
      if (!isIsoDate(date) || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Invalid daily rate record for ${date}.`);
      }
      changes += insert.run({ date, rate, fetchedAt }).changes;
    }
    return changes;
  });
  return write(rates);
}

export function readRates(db, { start, end } = {}) {
  const conditions = [];
  const parameters = {};
  if (start) {
    conditions.push('date >= @start');
    parameters.start = start;
  }
  if (end) {
    conditions.push('date <= @end');
    parameters.end = end;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT date, rate FROM daily_rates ${where} ORDER BY date`).all(parameters);
}

export function getLastRateDate(db) {
  return db.prepare('SELECT MAX(date) AS date FROM daily_rates').get().date ?? null;
}

export function setSyncTimestamp(db, timestamp) {
  db.prepare(`
    INSERT INTO sync_metadata (key, value) VALUES ('last_sync_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(timestamp);
}

export function getSyncTimestamp(db) {
  return db.prepare("SELECT value FROM sync_metadata WHERE key = 'last_sync_at'").get()?.value ?? null;
}
