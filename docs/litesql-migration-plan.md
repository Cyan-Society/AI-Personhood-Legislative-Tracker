# LiteSQL Migration Plan

## Goals
- Replace flat JSON persistence with a LiteSQL-backed source of truth for automated runs and published map data.
- Preserve the static choropleth experience by providing a JSON export layer derived from the database until the frontend can query an API directly.
- Keep LegiScan + Gemini automation reproducible by capturing raw inputs, model outputs, and publication snapshots in structured tables.

## Current State
- The automation script (`scripts/update-personhood.js`) writes aggregated state statuses to `data/state-legislation.json`, keeps per-run history in `data/legiscan-personhood-history.json`, and emits human/agent notes in `data/run-report.{json,md}`.
- The static map (`prototype-usa.html`) fetches `data/state-legislation.json` (with an inline fallback) to render categories, summaries, and citation links.
- There is no database; all persistence is file-based and versioned through Git.

## Target Architecture
- **Database:** LiteSQL server (single-writer, file-backed) with migrations tracked in Git for reproducibility.
- **Ingestion:** The existing Node script becomes the writer, persisting both raw LegiScan payloads and classified outputs instead of overwriting JSON files.
- **Publication:** A small API (or scheduled export job) reads from LiteSQL and produces the map-friendly JSON payload; the static HTML continues to consume JSON until we introduce live API calls.
- **Auditing:** Runs, model prompts, and classification rationales are stored in normalized tables to support replays and manual reviews.

## Proposed Schema (initial)
- `runs` — id, started_at, completed_at, search_query, gemini_model, force_review_flag, notes.
- `raw_bills` — id, run_id (FK), bill_id, state, change_hash, payload_json (LegiScan response), fetched_at.
- `classifications` — id, run_id (FK), raw_bill_id (FK to raw_bills.id), category, summary, rationale, citation, source_url, relevance_flag, reviewer, reviewed_at.
- `state_snapshots` — id, run_id (FK), state_code, category, summary, citation, source_url, derived_from_bill_ids (JSON array), published_flag.
- `exports` — id, run_id (FK), export_path, checksum, created_at (tracks JSON exports served to the frontend).

## Migration Steps
1. **Set up infra:** Add LiteSQL dependency and bootstrap migration tooling (e.g., `npm` script for applying schema files). Provide sample `.env` vars for DB path/URL.
2. **Backfill:** Write a one-off script to ingest existing `data/*.json` files into the new tables (states from `state-legislation.json`, historical bills from `legiscan-personhood-history.json`, run metadata from `run-report.json`).
3. **Update ingestion:** Refactor `scripts/update-personhood.js` to read prior state from LiteSQL, store new raw payloads + classifications, and write a `state_snapshots` row per state instead of mutating JSON files.
4. **Export layer:** Add an API route or CLI `npm run export-json` that renders `state-legislation.json` from the latest published snapshot for compatibility with `prototype-usa.html`.
5. **Frontend toggle:** Introduce a configuration flag in the HTML (or a small JS module) to request the API JSON endpoint, falling back to the bundled `data/state-legislation.json` during rollout.
6. **Observability:** Add basic health check and a lightweight integrity check (counts per table vs. expected states) to catch ingestion failures.
7. **Docs & runbooks:** Document setup, migration order, and rollback (e.g., re-export JSON from a prior run) for local and CI use.

## Rollout Plan
- **Phase 0: Local prototyping** — Create schema migrations, spin up LiteSQL locally, and validate read/write paths with a seed dataset derived from `data/state-legislation.json`.
- **Phase 1: Dual write/export** — Run `update-personhood.js` writes to LiteSQL and immediately export JSON for the map; keep existing JSON files in Git for diffing and fallback. Ship a read-only health endpoint.
- **Phase 2: Gate launch** — Add a feature flag in `prototype-usa.html` (or a small helper module) to load the exported JSON from the LiteSQL-backed endpoint by default, with an opt-out to the bundled JSON for a short overlap.
- **Phase 3: Cutover** — Stop committing regenerated JSON to Git; rely on exports produced from LiteSQL. Archive the one-off backfill script and document how to re-run it if the DB file is lost.
- **Phase 4: Hardening** — Add pruning/vacuum guidance, alerting hooks on failed runs, and a smoke-test script that validates counts and schema migrations in CI.

## Rollback & Recovery
- Keep the backfilled JSON exports under `data/` for at least one release so the map can be pinned to a known-good snapshot if the LiteSQL service fails.
- Document a one-command rollback: restore the previous `data/state-legislation.json` and `data/legiscan-personhood-history.json` from Git, disable the LiteSQL feature flag, and rerun `python -m http.server 8000` to serve the static map.
- Store migration files in Git so a failed deploy can roll back to the prior DB schema; include a `down` migration per `up` change where LiteSQL supports it.

## Testing Strategy
- **Unit-level fixtures:** Add deterministic fixtures for LegiScan payloads and Gemini outputs to exercise the LiteSQL write path without hitting external APIs.
- **Integration checks:** CI job applies migrations to a temporary LiteSQL database, runs the ingestion script against fixtures, and asserts that `state_snapshots` and `exports` contain expected rows.
- **Export parity:** Compare generated `state-legislation.json` from LiteSQL exports against the legacy JSON to confirm categories, summaries, and citations are unchanged during rollout.

## Team & Execution Plan
- **Team sizing:** 2 focused teams are sufficient—one for data/storage and one for application integration. A third (part-time) observability/QA role can be shared across teams.
- **Parallelizable tracks:**
  - **Track A — Data & migrations (Team 1):** Steps 1–2 (schema/migrations, backfill) and the database-facing portions of Step 3 (LiteSQL writes) can start immediately. Continues into Step 4 to expose an export job/API backed by the new tables.
  - **Track B — App integration (Team 2):** In parallel with Track A, begins on the frontend toggle in Step 5 and coordinates with automation updates in Step 3 to switch ingestion to LiteSQL outputs once the schema stabilizes. Owns final cutover tasks in Phase 3.
  - **Shared QA/Observability:** Step 6 (health/integrity checks) and Step 7 (docs/runbooks) are collaborative; QA can start drafting checks once the schema from Track A is defined and expand coverage as Track B adds the toggle and export consumption.
- **Critical sequencing:** Complete Step 2 backfill before enabling dual writes in production; Step 4 export parity must be validated before shipping the frontend toggle.
- **Rough timeline:**
  - Week 1: Track A delivers migrations and a backfill script; Track B prototypes the toggle with mock data.
  - Week 2: Track A adds dual-write ingestion + export job; Track B wires the toggle to real exports; QA drafts health checks.
  - Week 3: Export parity + health checks validated; enable gated rollout (Phase 2) and prep rollback docs.
  - Week 4: Cutover (Phase 3), hardening/alerts (Phase 4), and final runbooks.

## Open Questions / Risks
- **Concurrency:** LiteSQL is single-writer; ensure automation runs are serialized and API/export readers open separate read-only connections.
- **Retention:** Decide how many raw payloads to keep vs. pruning for space; consider periodic vacuuming.
- **Auth:** If an API is exposed publicly, add a lightweight auth/token layer to guard the export endpoint and health checks.
- **Testing:** Need fixtures for DB-backed ingestion to preserve determinism when Gemini is mocked.

## Success Criteria
- Automation runs no longer touch `data/state-legislation.json`; instead, they populate LiteSQL and emit exports via a reproducible command.
- The static map renders identical data from the exported JSON generated out of LiteSQL.
- Run histories, classifications, and prompts are queryable from the database to support audits and reprocessing.
