import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseFrankfurterRates, syncRates } from '../scripts/sync-rates.mjs';
import { getLastRateDate, getSyncTimestamp, openRateDatabase, readRates } from '../server/store.mjs';

test('parses valid GBP/INR reference observations and rejects malformed data', () => {
  assert.deepEqual(parseFrankfurterRates({
    base: 'GBP',
    rates: { '2025-01-02': { INR: 105.25 } },
  }), [{ date: '2025-01-02', rate: 105.25 }]);
  assert.throws(() => parseFrankfurterRates({ base: 'EUR', rates: {} }), /invalid GBP-based response/);
  assert.throws(() => parseFrankfurterRates({
    base: 'GBP',
    rates: { '2025-01-02': { INR: 0 } },
  }), /invalid GBP\/INR rate/);
  assert.throws(() => parseFrankfurterRates({
    base: 'GBP',
    rates: { '2025-02-30': { INR: 100 } },
  }), /invalid GBP\/INR rate/);
});

test('syncs rates incrementally, upserts safely, and exports sync metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gbp-inr-rates-'));
  const db = openRateDatabase(join(directory, 'rates.sqlite'));
  try {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          base: 'GBP',
          rates: { '2025-01-02': { INR: 105.25 }, '2025-01-03': { INR: 105.5 } },
        }),
      };
    };
    const result = await syncRates({ db, fetchImpl, now: new Date('2025-01-04T00:00:00.000Z') });
    assert.equal(calls[0], 'https://api.frankfurter.dev/v1/2000-01-01..?from=GBP&to=INR');
    assert.equal(result.inserted, 2);
    assert.equal(result.rates.length, 2);
    assert.equal(getLastRateDate(db), '2025-01-03');
    assert.equal(getSyncTimestamp(db), '2025-01-04T00:00:00.000Z');

    await syncRates({ db, fetchImpl, now: new Date('2025-01-05T00:00:00.000Z') });
    assert.equal(calls[1], 'https://api.frankfurter.dev/v1/2025-01-03..?from=GBP&to=INR');
    assert.equal(readRates(db).length, 2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
