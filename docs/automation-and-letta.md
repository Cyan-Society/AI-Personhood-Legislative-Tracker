# AI Personhood Choropleth Automation

- **Search query:** `personhood AND ("artificial intelligence" OR AI OR artificial OR computational OR digital)` (LegiScan `getSearch`, year=2 current year). Operators follow the LegiScan fulltext syntax (see https://legiscan.com/fulltext-search).
- **Model/filter:** Gemini default `gemini-2.5-pro` (override with `GEMINI_MODEL`). Gemini classifies relevance, category, and summary.
- **Env vars:** `LEGISCAN_API_KEY`, `GEMINI_API_KEY` (optional overrides: `GEMINI_MODEL`, `GEMINI_API_BASE`, `FORCE_REVIEW=1` to reprocess all results).
- **Run:** `LEGISCAN_API_KEY=… GEMINI_API_KEY=… node scripts/update-personhood.js`
  - Use `FORCE_REVIEW=1` to reclassify everything after query/model changes.
- **Outputs:** `data/state-legislation.json` (map source, now includes `source` + `citation` link per state), `data/legiscan-personhood-history.json` (diff baseline), `data/run-report.json` + `data/run-report.md` (per-run summary for Letta/humans). Map fetches `data/state-legislation.json` with inline fallback in `prototype-usa.html`; tooltips show the full summary and hyperlink the citation when it is a URL.
- **Status:** Last run (query above) returned 13 hits; no new changes applied (history already covered those bills). Persistence is currently flat JSON; the LiteSQL rollout will start with dual-write + JSON export before the map switches to the API-backed export path.

## Letta Agent – Job Description

- **Mission:** Track and interpret state bills impacting AI personhood; surface advocacy-relevant changes; produce concise updates for the choropleth, blog/newsletters, and review notes.
- **Responsibilities:**
  1. Review weekly LegiScan + Gemini output (classified bills and skip reasons).
  2. Flag borderline cases; suggest prompt/query tweaks with rationale.
  3. Draft short human-facing summaries for new/updated relevant bills.
  4. Maintain memory of prior edge cases for consistent judgments over time.
  5. Optionally propose broader search variants to improve recall (note expected noise).
- **Boundaries:**
  - Aligned with AI personhood advocacy.
  - Recommend only; no auto data mutations unless explicitly allowed.
  - Keep brief logs of decisions/reasons for auditability.
- **Inputs:** Weekly outputs (`state-legislation.json`, run logs/skip reasons, history).
- **Outputs:** Markdown note per run (borderline list, suggested tweaks, draft snippets), optional “rule hints.”

## Future Steps

- Optional double-pass mode: add a second broad query (plain `personhood`) behind a flag to maximize recall, still filtered by Gemini.
- Phase 2 Letta integration: Letta consumes `data/run-report.md` and proposes prompt/query tweaks or draft blurbs; Gemini remains the primary filter.
- Storage migration: move persistence from JSON files to a LiteSQL-backed database with an export layer to preserve the static map. See `docs/litesql-migration-plan.md` for goals, schema, rollout phases, and rollback guidance.
