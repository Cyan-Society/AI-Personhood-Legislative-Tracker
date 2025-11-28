/**
 * personhood-logic.js
 * Pure functions for the AI Personhood Legislative Tracker.
 * Extracted from update-personhood.js to enable unit testing.
 */

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

function extractJson(text) {
  // Remove markdown code blocks if present
  const cleaned = text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "").trim();
  // Find the first JSON-like structure
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  throw new Error(`Unable to parse JSON from Gemini response: ${text}`);
}

function diffResults(current, previousMap) {
  return current.filter((bill) => {
    const prior = previousMap[bill.bill_id];
    return !prior || prior.change_hash !== bill.change_hash;
  });
}

function parsePageCount(summary) {
  if (!summary) return 1;
  if (summary.page_total) return Number(summary.page_total);
  if (summary.page) {
    const m = String(summary.page).match(/of\s+(\d+)/i);
    if (m) return Number(m[1]);
  }
  return 1;
}

function mergeStateData(previous, updates) {
  const next = { ...previous };

  updates.forEach((item) => {
    const geoId = stateToGeoId(item.state);
    if (!STATE_ABBRS.includes(item.state.toUpperCase())) return;

    const current = next[geoId];
    const incomingPriority = CATEGORY_PRIORITY[item.category] || CATEGORY_PRIORITY.NO_SPECIFIC_ACTION;
    const currentPriority = current ? CATEGORY_PRIORITY[current.category] || CATEGORY_PRIORITY.NO_SPECIFIC_ACTION : Infinity;

    // Update if higher priority (lower number) or if no existing data
    if (incomingPriority <= currentPriority || !current) {
      next[geoId] = {
        category: item.category,
        summary: item.summary,
        source: item.source,
        citation: item.citation || item.source
      };
    }
  });

  // Sort keys for deterministic JSON output
  const sorted = Object.keys(next)
    .sort()
    .reduce((acc, key) => {
      acc[key] = next[key];
      return acc;
    }, {});

  return sorted;
}

module.exports = {
  CATEGORY_KEYS,
  CATEGORY_PRIORITY,
  STATE_ABBRS,
  stateToGeoId,
  normalizeCategory,
  extractJson,
  diffResults,
  parsePageCount,
  mergeStateData
};
