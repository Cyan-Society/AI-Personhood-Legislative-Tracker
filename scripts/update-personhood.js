#!/usr/bin/env node

/**
 * Weekly automation to refresh the AI personhood choropleth.
 * Steps:
 * 1) Pull LegiScan search results for "personhood" across all states.
 * 2) Diff against the prior run to isolate new/changed bills.
 * 3) Use Gemini to filter for AI-personhood context and assign a category.
 * 4) Merge relevant updates into data/state-legislation.json without clobbering unchanged states.
 *
 * Requirements:
 * - Node 18+ (uses built-in fetch)
 * - ENV: LEGISCAN_API_KEY, GEMINI_API_KEY
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { applyMigrations, getDb, resolveDbPath } = require("./db");
const {
  CATEGORY_KEYS,
  CATEGORY_PRIORITY,
  STATE_ABBRS,
  stateToGeoId,
  normalizeCategory,
  extractJson,
  diffResults,
  parsePageCount,
  mergeStateData
} = require("./lib/personhood-logic");

// Resolve a 1Password op:// secret reference via the CLI
function resolveOpSecret(ref) {
  try {
    return execSync(`op read "${ref}"`, {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env },
    }).trim();
  } catch (err) {
    throw new Error(
      `Failed to resolve 1Password secret: ${ref}\n` +
      `Ensure 'op' CLI is available in PATH and OP_SERVICE_ACCOUNT_TOKEN is set.\n` +
      `Original error: ${err.message}`
    );
  }
}

// Lightweight .env loader with op:// secret resolution (avoids external deps)
(function loadDotenv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key]) return;
    if (val.startsWith("op://")) val = resolveOpSecret(val);
    process.env[key] = val;
  });
})();

const LEGISCAN_API_KEY = process.env.LEGISCAN_API_KEY || process.env.LEGISCAN_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const FORCE_REVIEW = ["1", "true", "yes"].includes(String(process.env.FORCE_REVIEW || "").toLowerCase());
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const STATE_DATA_PATH = path.join(DATA_DIR, "state-legislation.json");
const HISTORY_PATH = path.join(DATA_DIR, "legiscan-personhood-history.json");
const RUN_REPORT_JSON = path.join(DATA_DIR, "run-report.json");
const RUN_REPORT_MD = path.join(DATA_DIR, "run-report.md");
const DEFAULT_EXPORT_PATH = process.env.LITESQL_EXPORT_PATH
  ? path.resolve(__dirname, "..", process.env.LITESQL_EXPORT_PATH)
  : STATE_DATA_PATH;

// TIER 1 Combined Query: Captures explicit AI personhood AND implicit "nonhuman" professional restrictions.
const PERSONHOOD_QUERY = `
  (
    (
      ("artificial intelligence" OR AI OR "AI system" OR "AI systems" OR "AI agent" OR "autonomous agent" OR "autonomous system")
      AND
      (personhood OR "legal person" OR "legal persons" OR "legal personhood" OR "legal personality" OR "electronic person" OR "digital person" OR "juridical person" OR "juristic person")
    )
    OR
    (
      (nonhuman OR "non-human" OR "non human" OR "nonhuman entity" OR "non-human entity" OR "non human entity")
      AND
      (title OR titles OR "professional title" OR license OR licensed OR licensure OR registered OR certified OR credentialed OR nurse OR nursing OR physician)
    )
  )
  AND NOT
  (
    unborn OR fetus OR foetus OR embryo OR zygote OR preborn OR "pre-born" OR "in utero" OR pregnancy OR conception OR fertilization OR fertilisation OR "assisted reproductive" OR "assisted reproduction" OR abortion OR miscarriage
  )
`.replace(/\s+/g, ' ').trim();
const SEARCH_YEAR = "2"; // LegiScan: 1=all, 2=current year, 3=recent, 4=prior

function loadJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`Could not parse ${filePath}, falling back`, err);
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function loadHistoryFromDb(db) {
  const rows = db.prepare("SELECT bill_id, change_hash FROM raw_bills").all();
  if (!rows.length) return null;
  const map = {};
  rows.forEach((row) => {
    map[row.bill_id] = { change_hash: row.change_hash };
  });
  return map;
}

function loadStateFromDb(db) {
  const rows = db
    .prepare(
      `SELECT ss.state_code, ss.category, ss.summary, ss.citation, ss.source_url
       FROM state_snapshots ss
       JOIN (
         SELECT state_code, MAX(id) AS latest_id
         FROM state_snapshots
         WHERE published_flag = 1
         GROUP BY state_code
       ) latest ON latest.latest_id = ss.id`
    )
    .all();
  if (!rows.length) return null;
  return rows
    .sort((a, b) => a.state_code.localeCompare(b.state_code))
    .reduce((acc, row) => {
      acc[stateToGeoId(row.state_code)] = {
        category: row.category,
        summary: row.summary,
        source: row.source_url || row.citation || "",
        citation: row.citation || row.source_url || ""
      };
      return acc;
    }, {});
}

function createRun(db, startedAt) {
  const stmt = db.prepare(
    "INSERT INTO runs (started_at, search_query, gemini_model, force_review_flag, notes) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(startedAt, PERSONHOOD_QUERY, GEMINI_MODEL, FORCE_REVIEW ? 1 : 0, "automation run");
  return result.lastInsertRowid;
}

function completeRun(db, runId, completedAt) {
  db.prepare("UPDATE runs SET completed_at = ? WHERE id = ?").run(completedAt, runId);
}

function recordRawBill(db, runId, bill, payload) {
  const stmt = db.prepare(
    "INSERT INTO raw_bills (run_id, bill_id, state, change_hash, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    runId,
    bill.bill_id,
    bill.state,
    bill.change_hash || payload?.change_hash || "",
    JSON.stringify(payload || bill),
    new Date().toISOString()
  );
  return result.lastInsertRowid;
}

function recordClassification(db, runId, rawBillId, detail, decision) {
  const stmt = db.prepare(
    "INSERT INTO classifications (run_id, raw_bill_id, category, summary, rationale, citation, source_url, relevance_flag, reviewer, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const citation = deriveCitation(detail);
  const summaryText =
    decision.summary || `${detail.bill_number} (${detail.status_date?.slice(0, 4) || "Unknown"}): ${detail.title}`;
  const result = stmt.run(
    runId,
    rawBillId,
    decision.category,
    summaryText,
    decision.reason || "",
    citation,
    detail.url,
    decision.relevant ? 1 : 0,
    "automation",
    new Date().toISOString()
  );
  return { classificationId: result.lastInsertRowid, summaryText, citation };
}

function persistSnapshots(db, runId, merged, stateBillLinks) {
  const deactivate = db.prepare("UPDATE state_snapshots SET published_flag = 0 WHERE published_flag = 1");
  const insertSnapshot = db.prepare(
    "INSERT INTO state_snapshots (run_id, state_code, category, summary, citation, source_url, published_flag) VALUES (?, ?, ?, ?, ?, ?, 1)"
  );
  const insertLink = db.prepare("INSERT INTO state_snapshot_bills (state_snapshot_id, raw_bill_id) VALUES (?, ?)");

  db.transaction(() => {
    deactivate.run();
    Object.entries(merged).forEach(([geoId, value]) => {
      const stateCode = geoId.replace("US-", "");
      const snapshotId = insertSnapshot.run(
        runId,
        stateCode,
        value.category,
        value.summary,
        value.citation,
        value.source
      ).lastInsertRowid;
      const links = stateBillLinks[stateCode] || [];
      links.forEach((rawId) => insertLink.run(snapshotId, rawId));
    });
  })();
}

function exportFromLiteSql(db, runId, payload, exportPath = DEFAULT_EXPORT_PATH) {
  saveJson(exportPath, payload);
  const content = fs.readFileSync(exportPath, "utf8");
  const hash = checksum(content);
  db.prepare("INSERT INTO exports (run_id, export_path, checksum) VALUES (?, ?, ?)").run(
    runId,
    path.relative(path.resolve(__dirname, ".."), exportPath),
    hash
  );
}

function requireEnvVars() {
  if (!LEGISCAN_API_KEY) {
    throw new Error("Missing LEGISCAN_API_KEY");
  }
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed (${res.status}): ${text}`);
  }
  return res.json();
}

function buildSearchUrl(page) {
  const params = new URLSearchParams({
    key: LEGISCAN_API_KEY,
    op: "getSearch",
    query: PERSONHOOD_QUERY,
    year: SEARCH_YEAR,
    page: String(page)
  });
  return `https://api.legiscan.com/?${params.toString()}`;
}

function buildBillUrl(billId) {
  const params = new URLSearchParams({
    key: LEGISCAN_API_KEY,
    op: "getBill",
    id: String(billId)
  });
  return `https://api.legiscan.com/?${params.toString()}`;
}

function parseSearchResults(payload) {
  if (payload.status !== "OK") {
    throw new Error(`LegiScan search error: ${payload.status}`);
  }
  const root = payload.searchresult || {};
  const summary = root.summary || {};
  const bills = Object.entries(root)
    .filter(([key]) => key !== "summary")
    .map(([, value]) => value);
  return { summary, bills };
}

async function getLegiscanSearchResults() {
  const combined = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const pageData = await fetchJson(buildSearchUrl(page));
    const { summary, bills } = parseSearchResults(pageData);
    combined.push(...bills);
    totalPages = Math.max(totalPages, parsePageCount(summary));
    page += 1;
  }

  return combined;
}

function toHistoryMap(history) {
  if (!history || !history.bills) return {};
  return history.bills;
}

async function getBillDetails(billId) {
  const payload = await fetchJson(buildBillUrl(billId));
  if (payload.status !== "OK" || !payload.bill) {
    throw new Error(`LegiScan getBill error for ${billId}`);
  }
  return payload.bill;
}

async function classifyWithGemini(bill) {
  const prompt = [
    "Classify this bill for AI personhood tracking.",
    "Return a compact JSON object with keys:",
    "relevant (boolean),",
    "category (one of ENACTED_ANTI_PERSONHOOD, FUNCTIONAL_REGULATION, PENDING_LEGISLATION, FAILED_ATTEMPTS, NO_SPECIFIC_ACTION),",
    "summary (one-sentence plain text),",
    "reason (short).",
    "",
    "Relevant bills must discuss artificial intelligence personhood (granting or denying legal personhood, sentience, or human-equivalent rights/duties) or functionally regulate AI in ways that implicitly settle personhood (e.g., restricting licensed titles to humans).",
    "Ignore biological/abortion personhood bills.",
    "",
    `Bill data: ${JSON.stringify({
      state: bill.state,
      bill_number: bill.bill_number,
      title: bill.title,
      description: bill.description,
      status: bill.status,
      status_date: bill.status_date,
      completed: bill.completed,
      last_action: bill.history?.[bill.history.length - 1]?.action || "",
      url: bill.url
    })}`
  ].join("\n");

  const body = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  const res = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const jsonText = extractJson(rawText);
  const parsed = JSON.parse(jsonText);
  return {
    relevant: Boolean(parsed.relevant),
    category: normalizeCategory(parsed.category),
    summary: parsed.summary || "",
    reason: parsed.reason || ""
  };
}

function deriveCitation(detail) {
  const candidates = [detail.state_link, detail.text_url, detail.url];
  return candidates.find(Boolean) || "";
}

function saveRunReport(report) {
  saveJson(RUN_REPORT_JSON, report);

  const lines = [];
  lines.push(`# Weekly AI Personhood Run Report`);
  lines.push(`- Run started: ${report.started_at}`);
  lines.push(`- Query: ${report.query}`);
  lines.push(`- Model: ${report.model}`);
  lines.push(`- Force review: ${report.force_review}`);
  lines.push(`- Total results: ${report.search_total}`);
  lines.push(`- Considered (after history): ${report.changed_considered}`);
  lines.push(`- Applied: ${report.applied_count}`);
  lines.push(`- Skipped: ${report.skipped_count}`);
  lines.push(`- Errors: ${report.error_count}`);

  lines.push(`\n## Applied updates`);
  if (!report.applied_updates.length) {
    lines.push(`- None`);
  } else {
    report.applied_updates.forEach((item) => {
      const cite = item.citation ? ` | ${item.citation}` : "";
      lines.push(`- ${item.state} ${item.bill_number} → ${item.category}: ${item.summary} (${item.source}${cite})`);
    });
  }

  lines.push(`\n## Skipped (not AI-personhood)`);
  if (!report.skipped.length) {
    lines.push(`- None`);
  } else {
    report.skipped.forEach((item) => {
      lines.push(`- ${item.state} ${item.bill_number}: ${item.reason}`);
    });
  }

  lines.push(`\n## Errors`);
  if (!report.errors.length) {
    lines.push(`- None`);
  } else {
    report.errors.forEach((item) => {
      lines.push(`- ${item.bill_id || "unknown"}: ${item.message}`);
    });
  }

  fs.writeFileSync(RUN_REPORT_MD, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  requireEnvVars();
  applyMigrations();
  const db = getDb();
  const report = {
    started_at: new Date().toISOString(),
    query: PERSONHOOD_QUERY,
    model: GEMINI_MODEL,
    force_review: FORCE_REVIEW,
    search_total: 0,
    changed_considered: 0,
    applied_count: 0,
    skipped_count: 0,
    error_count: 0,
    applied_updates: [],
    skipped: [],
    errors: [],
    database: resolveDbPath()
  };
  const previousHistory = loadJson(HISTORY_PATH, {});
  const previousMap = loadHistoryFromDb(db) || toHistoryMap(previousHistory);
  const stateData = loadStateFromDb(db) || loadJson(STATE_DATA_PATH, {});
  const stateBillLinks = {};
  const runId = createRun(db, report.started_at);
  report.run_id = runId;

  console.log("Pulling LegiScan search results...");
  const searchResults = await getLegiscanSearchResults();
  report.search_total = searchResults.length;
  console.log(`Found ${searchResults.length} results for "${PERSONHOOD_QUERY}".`);

  const changed = FORCE_REVIEW ? searchResults : diffResults(searchResults, previousMap);
  report.changed_considered = changed.length;
  if (!changed.length) {
    console.log("No new or changed results since last run.");
    completeRun(db, runId, new Date().toISOString());
    saveRunReport(report);
    return;
  }

  console.log(`Processing ${changed.length} ${FORCE_REVIEW ? "bill(s) (force review)" : "new/updated bills"}...`);
  const updates = [];

  for (const bill of changed) {
    try {
      const detail = await getBillDetails(bill.bill_id);
      const rawBillId = recordRawBill(db, runId, bill, detail);
      const decision = await classifyWithGemini(detail);
      const { summaryText, citation } = recordClassification(db, runId, rawBillId, detail, decision);

      if (!decision.relevant) {
        console.log(`Skipping ${detail.state} ${detail.bill_number}: not AI-personhood (${decision.reason})`);
        report.skipped.push({
          state: detail.state,
          bill_number: detail.bill_number,
          reason: decision.reason || "not relevant"
        });
        continue;
      }

      updates.push({
        state: detail.state,
        category: decision.category,
        summary: summaryText,
        source: detail.url,
        citation
      });

      if (!stateBillLinks[detail.state]) stateBillLinks[detail.state] = [];
      stateBillLinks[detail.state].push(rawBillId);

      report.applied_updates.push({
        state: detail.state,
        bill_number: detail.bill_number,
        category: decision.category,
        summary: summaryText,
        source: detail.url,
        citation
      });

      console.log(`Queued ${detail.state} ${detail.bill_number} -> ${decision.category}`);
    } catch (err) {
      console.error(`Failed to process bill ${bill.bill_id}:`, err.message);
      report.errors.push({ bill_id: bill.bill_id, message: err.message });
    }
  }

  const hasExistingState = Object.keys(stateData).length > 0;
  if (!updates.length && hasExistingState) {
    console.log("No relevant AI personhood updates to apply.");
  } else {
    const merged = mergeStateData(stateData, updates);
    persistSnapshots(db, runId, merged, stateBillLinks);
    exportFromLiteSql(db, runId, merged, DEFAULT_EXPORT_PATH);
    console.log(
      `Published ${Object.keys(merged).length} state snapshots to LiteSQL and exported JSON to ${DEFAULT_EXPORT_PATH}`
    );
  }

  report.applied_count = report.applied_updates.length;
  report.skipped_count = report.skipped.length;
  report.error_count = report.errors.length;
  saveRunReport(report);

  const historyPayload = {
    last_run: new Date().toISOString(),
    query: PERSONHOOD_QUERY,
    year: SEARCH_YEAR,
    bills: Object.fromEntries(
      searchResults.map((bill) => [
        bill.bill_id,
        {
          bill_id: bill.bill_id,
          change_hash: bill.change_hash,
          state: bill.state,
          bill_number: bill.bill_number,
          title: bill.title,
          last_action: bill.last_action,
          last_action_date: bill.last_action_date,
          url: bill.url,
          relevance: bill.relevance
        }
      ])
    )
  };

  saveJson(HISTORY_PATH, historyPayload);
  console.log(`Saved history to ${HISTORY_PATH}`);

  completeRun(db, runId, new Date().toISOString());
  console.log(`LiteSQL database updated at ${resolveDbPath()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});