# Repository Guidelines

## Project Structure & Module Organization
- Root contains `prototype-usa.html`, a static amCharts choropleth for AI personhood statuses across U.S. states.
- Styling is pulled from Tailwind CDN; map rendering and data live in the inline `<script>` block (see `categories` and `stateData` objects).
- Keep additional assets beside the HTML (e.g., `data/` for CSV/JSON, `img/` for screenshots) to avoid breaking relative paths.
- Automation docs and Letta role live in `docs/automation-and-letta.md`.

## Build, Test, and Development Commands
- Serve locally to avoid CORS quirks: `python -m http.server 8000` then open `http://localhost:8000/prototype-usa.html`.
- For quick validation, just open the file directly in a browser, but prefer the local server when loading future external assets.
- After edits, hard-refresh with devtools open to confirm tooltips, colors, and zoom controls still work.

## Coding Style & Naming Conventions
- Use 2-space indentation; keep HTML/JS in the existing style (double quotes in HTML attributes, camelCase for JS variables, UPPER_SNAKE for future shared constants).
- Group data first (category definitions, state mappings), then chart configuration, then styling tweaks; add short inline comments only where logic is non-obvious.
- If adding scripts or styles, prefer separate files and reference them with relative paths from the HTML root.

## Testing Guidelines
- No automated test suite; rely on manual checks in modern browsers (Chrome/Firefox). Validate that each state renders, tooltips wrap correctly, and legend colors match the `categories` palette.
- When adding states or categories, verify hover states, zoom controls, and that default fills still apply to missing data.

## Commit & Pull Request Guidelines
- Use concise, present-tense commits (e.g., "Add WA failed-attempt tooltip", "Tighten legend spacing").
- PRs should note scope, screenshots of the map/legend after changes, and any data sources consulted. Link issues if applicable and call out any new external dependencies (CDNs, datasets).

## Data & Content Updates
- Keep category colors and wording consistent with the legend; adjust both the `categories` object and legend markup together.
- Document the source and year for new legal entries in `stateData.summary` so changes remain auditable.
- Automation pipeline: `scripts/update-personhood.js` fetches LegiScan search results (current query: `personhood AND ("artificial intelligence" OR AI OR artificial OR computational OR digital)`), classifies with Gemini (default `gemini-2.5-pro`), updates `data/state-legislation.json` (includes `source` + `citation` link per state), records history in `data/legiscan-personhood-history.json`, and writes `data/run-report.{json,md}` (per-run summary for Letta/humans). Tooltips show the full summary and hyperlink the citation when it is a URL. Use `FORCE_REVIEW=1` to reprocess all results after query/model changes.
