# LiteSQL Migration Runbook

## Setup
- Install dependencies and apply migrations:
  - `npm install`
  - `npm run migrate`
- Copy `.env.example` to `.env` and set:
  - `LITESQL_URL` (file path for the LiteSQL database, defaults to `./data/personhood.db`)
  - `LITESQL_EXPORT_PATH` (optional JSON export destination, defaults to `data/state-legislation.json`)
  - `LEGISCAN_API_KEY`, `GEMINI_API_KEY`, and optional `GEMINI_MODEL` / `FORCE_REVIEW` flags.

## One-time Backfill
Populate LiteSQL using the existing JSON artifacts before enabling automated runs:
- `npm run backfill:litesql`
- Verifies schema, clears existing rows, and imports:
  - `data/legiscan-personhood-history.json` → `raw_bills`
  - `data/run-report.json` → `runs` + `classifications`
  - `data/state-legislation.json` → `state_snapshots` + `exports`

## Weekly Automation
- Primary writer: `npm run update`
  - Applies migrations automatically.
  - Records LegiScan search results + Gemini classifications into LiteSQL.
  - Publishes `state_snapshots` and exports JSON via `exports` rows.
  - Still writes `data/legiscan-personhood-history.json` and `data/run-report.{json,md}` for rollback visibility.

## JSON Export (compatibility with prototype-usa.html)
- On-demand export from the latest published snapshots:
  - `npm run export:litesql`
- Output defaults to `data/state-legislation.json` (configurable via `LITESQL_EXPORT_PATH`).

## Frontend Toggle
- `prototype-usa.html` tries `api/state-legislation.json` first (for LiteSQL-backed exports) and falls back to the bundled `data/state-legislation.json` for offline use.

## Health & Integrity Checks
- Quick coverage + row counts:
  - `npm run health:litesql`
- Warns when published snapshots cover fewer than the expected 56 states/territories.

## Rollback
- Restore the previously committed `data/state-legislation.json` and `data/legiscan-personhood-history.json` if LiteSQL fails.
- Set `LITESQL_URL` to a new path and rerun `npm run migrate` + `npm run backfill:litesql` to rebuild the database from JSON.
