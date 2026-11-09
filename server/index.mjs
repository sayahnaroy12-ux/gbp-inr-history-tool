import express from 'express';
import { getSyncTimestamp, isIsoDate, openRateDatabase, readRates } from './store.mjs';

const app = express();
const db = openRateDatabase();
const port = Number(process.env.PORT ?? 8787);

app.use((request, response, next) => {
  response.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', latest_date: readRates(db).at(-1)?.date ?? null });
});

app.get('/api/rates', (request, response) => {
  const { start, end } = request.query;
  if ((start && (typeof start !== 'string' || !isIsoDate(start))) ||
      (end && (typeof end !== 'string' || !isIsoDate(end)))) {
    response.status(400).json({ error: 'start and end must be valid YYYY-MM-DD dates.' });
    return;
  }
  if (start && end && start > end) {
    response.status(400).json({ error: 'start must not be later than end.' });
    return;
  }
  const observations = readRates(db, { start, end });
  if (observations.length === 0) {
    response.status(404).json({ error: 'No GBP/INR daily reference rates found for this range.' });
    return;
  }
  response.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  response.json({
    amount: 1,
    base: 'GBP',
    start_date: observations[0].date,
    end_date: observations.at(-1).date,
    updated_at: getSyncTimestamp(db),
    source: 'Frankfurter / ECB daily reference rates',
    rates: Object.fromEntries(observations.map(({ date, rate }) => [date, { INR: rate }])),
  });
});

app.listen(port, () => {
  console.log(`GBP/INR rates API listening on port ${port}.`);
});
