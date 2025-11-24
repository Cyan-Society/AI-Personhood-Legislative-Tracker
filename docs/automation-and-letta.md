# AI Personhood Choropleth Automation

- **Search query:** `personhood AND ("artificial intelligence" OR AI OR artificial OR computational OR digital)` (LegiScan `getSearch`, year=2 current year).
- **Model/filter:** Gemini default `gemini-2.5-pro` (override with `GEMINI_MODEL`). Gemini classifies relevance, category, and summary.
- **Env vars:** `LEGISCAN_API_KEY`, `GEMINI_API_KEY` (optional overrides: `GEMINI_MODEL`, `GEMINI_API_BASE`, `FORCE_REVIEW=1` to reprocess all results).
- **Run:** `LEGISCAN_API_KEY=… GEMINI_API_KEY=… node scripts/update-personhood.js`
  - Use `FORCE_REVIEW=1` to reclassify everything after query/model changes.
- **Outputs:** `data/state-legislation.json` (map source), `data/legiscan-personhood-history.json` (diff baseline). Map fetches `data/state-legislation.json` with inline fallback in `prototype-usa.html`.
- **Status:** Last run (query above) returned 13 hits; no new changes applied (history already covered those bills).

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
- Phase 1 Letta integration: generate a markdown note after each run with borderline items and suggested tweaks; keep Gemini as primary filter.
