#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { applyMigrations, getDb, resolveDbPath } = require("./db");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const DEFAULT_EXPORT_PATH = path.resolve(__dirname, "..", "data", "state-legislation.json");

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function latestSnapshots(db) {
  const rows = db
    .prepare(
      `SELECT ss.*
       FROM state_snapshots ss
       JOIN (
         SELECT state_code, MAX(id) AS latest_id
         FROM state_snapshots
         WHERE published_flag = 1
         GROUP BY state_code
       ) latest ON latest.latest_id = ss.id`
    )
    .all();
  return rows;
}

function exportJson() {
  applyMigrations();
  const db = getDb();
  const snapshots = latestSnapshots(db);
  if (!snapshots.length) {
    throw new Error("No published state snapshots found in LiteSQL database");
  }

  const payload = snapshots
    .sort((a, b) => a.state_code.localeCompare(b.state_code))
    .reduce((acc, snapshot) => {
      acc[`US-${snapshot.state_code}`] = {
        category: snapshot.category,
        summary: snapshot.summary,
        source: snapshot.source_url || snapshot.citation || "",
        citation: snapshot.citation || snapshot.source_url || ""
      };
      return acc;
    }, {});

  const exportPath = process.env.LITESQL_EXPORT_PATH
    ? path.resolve(__dirname, "..", process.env.LITESQL_EXPORT_PATH)
    : DEFAULT_EXPORT_PATH;

  saveJson(exportPath, payload);
  const content = fs.readFileSync(exportPath, "utf8");
  const hash = checksum(content);

  const runId = snapshots[0].run_id;
  db.prepare("INSERT INTO exports (run_id, export_path, checksum) VALUES (?, ?, ?)").run(
    runId,
    path.relative(path.resolve(__dirname, ".."), exportPath),
    hash
  );

  console.log(`Exported ${Object.keys(payload).length} states to ${exportPath}`);
  console.log(`LiteSQL: ${resolveDbPath()}`);
}

exportJson();
