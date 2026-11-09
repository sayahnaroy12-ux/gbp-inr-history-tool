<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/64ee825e-407f-4749-a432-9010cafa3826

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## GBP/INR rate data

The rate tracker uses Frankfurter's ECB daily reference rates for its historical and daily views. It stores those observations in `data/gbp-inr.sqlite` and exports `public/data/daily-rates.json` for the static GitHub Pages site. `.github/workflows/sync-daily-rates.yml` refreshes the database and deploys the updated static site on weekdays; minute-level FXRatesAPI snapshots are transient and are not persisted. Use Node.js 22 for the SQLite-backed commands.

To sync locally, run `npm run sync:rates`. To run the optional read-only API against the same SQLite database, run `npm run start:api` and set `DATABASE_PATH` if the database is elsewhere. The API listens on port `8787` by default, serves `GET /api/rates` (optional `start` and `end` dates in `YYYY-MM-DD` format) and `GET /api/health`, and allows cross-origin read access by default. Set `CORS_ORIGIN` to restrict the allowed origin. The static site does not require the API; to use a hosted API, set `VITE_API_BASE_URL` to its base URL before building.

The Express API is not deployed by GitHub Pages. Hosting it requires a separate Node-capable service with a persistent SQLite volume; the scheduled workflow keeps the static Pages snapshot current independently.
