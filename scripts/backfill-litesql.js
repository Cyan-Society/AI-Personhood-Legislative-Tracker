#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { applyMigrations, getDb, resolveDbPath } = require("./db");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const STATE_DATA_PATH = path.join(DATA_DIR, "state-legislation.json");
const HISTORY_PATH = path.join(DATA_DIR, "legiscan-personhood-history.json");
const RUN_REPORT_PATH = path.join(DATA_DIR, "run-report.json");

function loadJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resetTables(db) {
  db.exec(
    [
      "DELETE FROM state_snapshot_bills;",
      "DELETE FROM state_snapshots;",
      "DELETE FROM classifications;",
      "DELETE FROM raw_bills;",
      "DELETE FROM exports;",
      "DELETE FROM runs;"
    ].join("\n")
  );
}

function backfill() {
  applyMigrations();
  const db = getDb();
  const stateData = loadJson(STATE_DATA_PATH, {});
  const history = loadJson(HISTORY_PATH, {});
  const runReport = loadJson(RUN_REPORT_PATH, {});

  const startedAt = runReport.started_at || history.last_run || new Date().toISOString();
  const completedAt = startedAt;
  const notes = "Backfilled from legacy JSON artifacts";

  const insertRun = db.prepare(
    "INSERT INTO runs (started_at, completed_at, search_query, gemini_model, force_review_flag, notes) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertRaw = db.prepare(
    "INSERT INTO raw_bills (run_id, bill_id, state, change_hash, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertClassification = db.prepare(
    "INSERT INTO classifications (run_id, raw_bill_id, category, summary, rationale, citation, source_url, relevance_flag, reviewer, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertSnapshot = db.prepare(
    "INSERT INTO state_snapshots (run_id, state_code, category, summary, citation, source_url, published_flag) VALUES (?, ?, ?, ?, ?, ?, 1)"
  );
  const insertSnapshotBill = db.prepare(
    "INSERT INTO state_snapshot_bills (state_snapshot_id, raw_bill_id) VALUES (?, ?)"
  );
  const insertExport = db.prepare(
    "INSERT INTO exports (run_id, export_path, checksum) VALUES (?, ?, ?)"
  );

  db.transaction(() => {
    resetTables(db);

    const runInfo = insertRun.run(
      startedAt,
      completedAt,
      history.query || runReport.query || "",
      runReport.model || "",
      runReport.force_review ? 1 : 0,
      notes
    );
    const runId = runInfo.lastInsertRowid;

    const billIndex = new Map();
    const bills = history.bills || {};
    Object.values(bills).forEach((bill) => {
      const rawId = insertRaw.run(
        runId,
        bill.bill_id,
        bill.state,
        bill.change_hash || "",
        JSON.stringify(bill),
        history.last_run || startedAt
      ).lastInsertRowid;
      billIndex.set(`${bill.state}:${bill.bill_number}`, rawId);
    });

    const applied = runReport.applied_updates || [];
    const stateBillLinks = {};
    applied.forEach((item) => {
      const rawBillId = billIndex.get(`${item.state}:${item.bill_number}`) || null;
      insertClassification.run(
        runId,
        rawBillId,
        item.category || "NO_SPECIFIC_ACTION",
        item.summary || "",
        "Migrated from run-report.json",
        item.citation || "",
        item.source || "",
        1,
        "migration",
        runReport.started_at || startedAt
      );
      if (!rawBillId) return;
      if (!stateBillLinks[item.state]) stateBillLinks[item.state] = [];
      stateBillLinks[item.state].push(rawBillId);
    });

    const snapshots = Object.entries(stateData);
    const snapshotLinks = [];
    snapshots.forEach(([geoId, value]) => {
      const stateCode = geoId.replace("US-", "");
      const snapshotId = insertSnapshot.run(
        runId,
        stateCode,
        value.category || "NO_SPECIFIC_ACTION",
        value.summary || "",
        value.citation || value.source || "",
        value.source || ""
      ).lastInsertRowid;
      snapshotLinks.push({ stateCode, snapshotId });
    });

    snapshotLinks.forEach(({ stateCode, snapshotId }) => {
      const rawIds = stateBillLinks[stateCode] || [];
      rawIds.forEach((rawId) => insertSnapshotBill.run(snapshotId, rawId));
    });

    if (fs.existsSync(STATE_DATA_PATH)) {
      const jsonContent = fs.readFileSync(STATE_DATA_PATH, "utf8");
      const hash = checksum(jsonContent);
      insertExport.run(runId, path.relative(path.resolve(__dirname, ".."), STATE_DATA_PATH), hash);
    }
  })();

  console.log(`Backfill complete. Database ready at ${resolveDbPath()}`);
}

backfill();
