import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLastRateDate, isIsoDate, openRateDatabase, readRates, setSyncTimestamp, upsertRates } from '../server/store.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exportPath = resolve(projectRoot, 'public/data/daily-rates.json');

export function parseFrankfurterRates(payload) {
  if (payload?.base !== 'GBP' || !payload.rates || typeof payload.rates !== 'object') {
    throw new Error('Frankfurter returned an invalid GBP-based response.');
  }
  return Object.entries(payload.rates).map(([date, currencies]) => {
    const rate = currencies?.INR;
    if (!isIsoDate(date) || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Frankfurter returned an invalid GBP/INR rate for ${date}.`);
    }
    return { date, rate };
  });
}

export async function syncRates({ db, fetchImpl = fetch, now = new Date() }) {
  const startDate = getLastRateDate(db) ?? '2000-01-01';
  const endpoint = `https://api.frankfurter.dev/v1/${startDate}..?from=GBP&to=INR`;
  const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Frankfurter rate sync failed (HTTP ${response.status}).`);

  const rates = parseFrankfurterRates(await response.json());
  if (rates.length === 0 && !getLastRateDate(db)) {
    throw new Error('Frankfurter returned no data for the initial rate sync.');
  }
  const syncedAt = now.toISOString();
  const inserted = upsertRates(db, rates, syncedAt);
  setSyncTimestamp(db, syncedAt);
  const storedRates = readRates(db);
  if (storedRates.length === 0) throw new Error('Rate sync completed without storing any observations.');
  return { inserted, syncedAt, rates: storedRates };
}

async function main() {
  const db = openRateDatabase();
  try {
    const result = await syncRates({ db });
    const payload = {
      amount: 1,
      base: 'GBP',
      start_date: result.rates[0].date,
      end_date: result.rates.at(-1).date,
      updated_at: result.syncedAt,
      source: 'Frankfurter / ECB daily reference rates',
      rates: Object.fromEntries(result.rates.map(({ date, rate }) => [date, { INR: rate }])),
    };
    await mkdir(dirname(exportPath), { recursive: true });
    await writeFile(exportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`Synchronized ${result.rates.length} daily observations; ${result.inserted} inserted or updated.`);
    console.log(`Snapshot exported to ${exportPath}.`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Rate synchronization failed:', error);
    process.exitCode = 1;
  });
}
