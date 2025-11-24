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

const LEGISCAN_API_KEY = process.env.LEGISCAN_API_KEY || process.env.LEGISCAN_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const FORCE_REVIEW = ["1", "true", "yes"].includes(String(process.env.FORCE_REVIEW || "").toLowerCase());
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const GEMINI_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const STATE_DATA_PATH = path.join(DATA_DIR, "state-legislation.json");
const HISTORY_PATH = path.join(DATA_DIR, "legiscan-personhood-history.json");

const PERSONHOOD_QUERY = 'personhood AND ("artificial intelligence" OR AI OR artificial OR computational OR digital)';
const SEARCH_YEAR = "2"; // LegiScan: 1=all, 2=current year, 3=recent, 4=prior

const CATEGORY_KEYS = {
  ENACTED_ANTI_PERSONHOOD: "Enacted anti-personhood laws",
  FUNCTIONAL_REGULATION: "Functional regulation",
  PENDING_LEGISLATION: "Pending legislation",
  FAILED_ATTEMPTS: "Failed attempts",
  NO_SPECIFIC_ACTION: "No specific action"
};

const CATEGORY_PRIORITY = {
  ENACTED_ANTI_PERSONHOOD: 1,
  FUNCTIONAL_REGULATION: 2,
  PENDING_LEGISLATION: 3,
  FAILED_ATTEMPTS: 4,
  NO_SPECIFIC_ACTION: 5
};

const STATE_ABBRS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP"
];

const stateToGeoId = (state) => `US-${state.toUpperCase()}`;

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

function parsePageCount(summary) {
  if (!summary) return 1;
  if (summary.page_total) return Number(summary.page_total);
  if (summary.page) {
    const m = String(summary.page).match(/of\\s+(\\d+)/i);
    if (m) return Number(m[1]);
  }
  return 1;
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

function diffResults(current, previousMap) {
  return current.filter((bill) => {
    const prior = previousMap[bill.bill_id];
    return !prior || prior.change_hash !== bill.change_hash;
  });
}

async function getBillDetails(billId) {
  const payload = await fetchJson(buildBillUrl(billId));
  if (payload.status !== "OK" || !payload.bill) {
    throw new Error(`LegiScan getBill error for ${billId}`);
  }
  return payload.bill;
}

function normalizeCategory(label) {
  if (!label) return "NO_SPECIFIC_ACTION";
  const normalized = label.trim().toUpperCase().replace(/[^A-Z]+/g, "_");
  if (CATEGORY_KEYS[normalized]) return normalized;

  const aliasMap = {
    ENACTED: "ENACTED_ANTI_PERSONHOOD",
    ANTI_PERSONHOOD: "ENACTED_ANTI_PERSONHOOD",
    FUNCTIONAL: "FUNCTIONAL_REGULATION",
    PENDING: "PENDING_LEGISLATION",
    FAILED: "FAILED_ATTEMPTS",
    NONE: "NO_SPECIFIC_ACTION"
  };
  return aliasMap[normalized] || "NO_SPECIFIC_ACTION";
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
  ].join("\\n");

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

function extractJson(text) {
  const cleaned = text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  throw new Error(`Unable to parse JSON from Gemini response: ${text}`);
}

function mergeStateData(previous, updates) {
  const next = { ...previous };

  updates.forEach((item) => {
    const geoId = stateToGeoId(item.state);
    if (!STATE_ABBRS.includes(item.state.toUpperCase())) return;

    const current = next[geoId];
    const incomingPriority = CATEGORY_PRIORITY[item.category] || CATEGORY_PRIORITY.NO_SPECIFIC_ACTION;
    const currentPriority = current ? CATEGORY_PRIORITY[current.category] || CATEGORY_PRIORITY.NO_SPECIFIC_ACTION : Infinity;

    if (incomingPriority <= currentPriority || !current) {
      next[geoId] = {
        category: item.category,
        summary: item.summary,
        source: item.source
      };
    }
  });

  const sorted = Object.keys(next)
    .sort()
    .reduce((acc, key) => {
      acc[key] = next[key];
      return acc;
    }, {});

  return sorted;
}

async function main() {
  requireEnvVars();
  const previousHistory = loadJson(HISTORY_PATH, {});
  const previousMap = toHistoryMap(previousHistory);
  const stateData = loadJson(STATE_DATA_PATH, {});

  console.log("Pulling LegiScan search results...");
  const searchResults = await getLegiscanSearchResults();
  console.log(`Found ${searchResults.length} results for "${PERSONHOOD_QUERY}".`);

  const changed = FORCE_REVIEW ? searchResults : diffResults(searchResults, previousMap);
  if (!changed.length) {
    console.log("No new or changed results since last run.");
    return;
  }

  console.log(`Processing ${changed.length} ${FORCE_REVIEW ? "bill(s) (force review)" : "new/updated bills"}...`);
  const updates = [];

  for (const bill of changed) {
    try {
      const detail = await getBillDetails(bill.bill_id);
      const decision = await classifyWithGemini(detail);
      if (!decision.relevant) {
        console.log(`Skipping ${detail.state} ${detail.bill_number}: not AI-personhood (${decision.reason})`);
        continue;
      }

      const summaryText =
        decision.summary ||
        `${detail.bill_number} (${detail.status_date?.slice(0, 4) || "Unknown"}): ${detail.title}`;

      updates.push({
        state: detail.state,
        category: decision.category,
        summary: summaryText,
        source: detail.url
      });

      console.log(`Queued ${detail.state} ${detail.bill_number} -> ${decision.category}`);
    } catch (err) {
      console.error(`Failed to process bill ${bill.bill_id}:`, err.message);
    }
  }

  if (!updates.length) {
    console.log("No relevant AI personhood updates to apply.");
  } else {
    const merged = mergeStateData(stateData, updates);
    saveJson(STATE_DATA_PATH, merged);
    console.log(`Updated ${STATE_DATA_PATH}`);
  }

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
