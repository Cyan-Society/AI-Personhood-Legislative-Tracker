/**
 * gemini.js
 * Pure helpers for building Gemini classification requests and reading the
 * responses, for both direct generateContent calls and Batch API jobs.
 */

const { extractJson, normalizeCategory } = require("./personhood-logic");

function buildClassificationPrompt(bill) {
  return [
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
}

// thinkingLevel is LOW, MEDIUM or HIGH and only works on Gemini 3+ models;
// pass an empty value to leave thinking at the model default.
function buildGenerateContentRequest(prompt, thinkingLevel) {
  const request = { contents: [{ parts: [{ text: prompt }] }] };
  if (thinkingLevel) {
    request.generationConfig = {
      thinkingConfig: { thinkingLevel: String(thinkingLevel).toUpperCase() }
    };
  }
  return request;
}

function parseClassification(response) {
  const rawText =
    response?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text)
      .join("") || "";
  const parsed = JSON.parse(extractJson(rawText));
  return {
    relevant: Boolean(parsed.relevant),
    category: normalizeCategory(parsed.category),
    summary: parsed.summary || "",
    reason: parsed.reason || ""
  };
}

function buildBatchBody(requests, displayName) {
  return {
    batch: {
      display_name: displayName,
      input_config: {
        requests: {
          requests: requests.map(({ key, request }) => ({
            request,
            metadata: { key: String(key) }
          }))
        }
      }
    }
  };
}

// The live REST API returns BATCH_STATE_* (checked 2026-11-03) while the docs show
// JOB_STATE_*, so match on the suffix. `done` is absent, not false, while running.
function readBatchStatus(operation) {
  const state = operation?.metadata?.state || "";
  const failed = /_(FAILED|CANCELLED|EXPIRED)$/.test(state) || Boolean(operation?.error);
  const succeeded = /_SUCCEEDED$/.test(state) || (operation?.done === true && !failed);
  return { state, done: operation?.done === true || succeeded || failed, succeeded: succeeded && !failed };
}

function readBatchResults(operation) {
  const container =
    operation?.response?.inlinedResponses ?? operation?.metadata?.output?.inlinedResponses;
  if (!container) {
    if (operation?.response?.responsesFile) {
      throw new Error("Gemini batch returned a results file; only inline results are supported");
    }
    return [];
  }
  const items = Array.isArray(container) ? container : container.inlinedResponses || [];
  return items.map((item, index) => ({
    key: item.metadata?.key ?? null,
    index,
    response: item.response,
    error: item.error
  }));
}

module.exports = {
  buildClassificationPrompt,
  buildGenerateContentRequest,
  parseClassification,
  buildBatchBody,
  readBatchStatus,
  readBatchResults
};
