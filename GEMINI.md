# AI Personhood Legislative Tracker

## Project Overview
The AI Personhood Legislative Tracker monitors and visualizes legislation regarding the personhood of Artificial Intelligence across the United States. It automates the collection of legislative data via the **LegiScan API**, classifies bills using **Google Gemini models**, stores the history in a local **SQLite** database (referred to as LiteSQL), and visualizes the current status on an interactive US map.

## Setup and Installation

1.  **Dependencies:**
    ```bash
    npm install
    ```

2.  **Environment Configuration:**
    Copy `.env.example` to `.env` and populate the following:
    *   `LEGISCAN_API_KEY`: API key for fetching legislative data.
    *   `GEMINI_API_KEY`: API key for the Gemini model used in classification.
    *   `LITESQL_URL`: Path to the SQLite database (default: `./data/personhood.db`).
    *   `LITESQL_EXPORT_PATH`: Path for JSON export (default: `data/state-legislation.json`).
    *   `GEMINI_MODEL` (Optional): Specific model version (default `gemini-3.8-flash`).
    *   `GEMINI_THINKING_LEVEL` (Optional): `LOW`, `MEDIUM` or `HIGH` (default `HIGH`); leave empty for pre-Gemini-3 models.
    *   `GEMINI_BATCH` (Optional): `1` (default) classifies all bills in one Batch API job at half price; `0` makes direct calls.
    *   `GEMINI_BATCH_POLL_SECONDS` / `GEMINI_BATCH_MAX_WAIT_MINUTES` (Optional): batch polling interval (default 30, minimum 5) and how long to wait before cancelling (default 300).
    *   `FORCE_REVIEW` (Optional): Set to `1` to force re-classification of all data.

3.  **Database Initialization:**
    Run migrations to set up the SQLite schema:
    ```bash
    npm run migrate
    ```
    Optionally, backfill the database from existing JSON data:
    ```bash
    npm run backfill:litesql
    ```

## Automation Workflow

The core automation logic is handled by `scripts/update-personhood.js`.

### **Command:**
```bash
npm run update
```

### **Process:**
1.  **Fetch:** Queries the LegiScan API for bills matching: `personhood AND ("artificial intelligence" OR AI OR artificial OR computational OR digital)`.
2.  **Classify:** Uses the Gemini API to classify the relevance and status of the fetched bills.
3.  **Store:** Saves the results into the SQLite database (`raw_bills`, `classifications`, `runs`).
4.  **Snapshot:** Updates the current status for each state in the `state_snapshots` table.
5.  **Export:** Generates a static JSON file (`data/state-legislation.json`) and reports (`data/run-report.json`, `data/run-report.md`).

## Database Management (LiteSQL)

The project uses `better-sqlite3` for local data storage.

*   **Apply Migrations:** `npm run migrate` (Uses `scripts/migrations/001_init.sql`)
*   **Backfill from JSON:** `npm run backfill:litesql`
*   **Export to JSON:** `npm run export:litesql` (Updates `data/state-legislation.json` from DB)
*   **Health Check:** `npm run health:litesql` (Verifies data integrity)

See `docs/litesql-runbook.md` for detailed operational procedures.

## Frontend Visualization

*   **File:** `prototype-usa.html`
*   **Description:** A standalone HTML file utilizing **amCharts** and **Tailwind CSS** (via CDN) to render a choropleth map of the US.
*   **Data Source:** Reads from `data/state-legislation.json`.
*   **Running Locally:**
    ```bash
    python -m http.server 8000
    # Open http://localhost:8000/prototype-usa.html
    ```

## Key Directory Structure

*   **`data/`**: Contains the SQLite database, JSON data artifacts, and run reports.
*   **`docs/`**: Project documentation including automation guides and database runbooks.
*   **`scripts/`**: Node.js scripts for automation, database management, and migration.
    *   `migrations/`: SQL files for database schema changes.
*   **`prototype-usa.html`**: The main frontend visualization file.
*   **`AGENTS.md`**: High-level project guidelines and structure info.

## Conventions

*   **Code Style:** Standard JavaScript/Node.js conventions. 2-space indentation.
*   **Data:** "LiteSQL" refers to the project's specific usage of SQLite.
*   **Classification:** Uses Gemini to categorize legislation; manual overrides or re-runs can be forced via environment variables.
