#!/usr/bin/env node
const { applyMigrations, getDb, resolveDbPath } = require("./db");

const EXPECTED_STATES = 56; // 50 states + DC, PR, VI, GU, AS, MP

function main() {
  applyMigrations();
  const db = getDb();
  const counts = {
    runs: db.prepare("SELECT COUNT(*) as count FROM runs").get().count,
    raw_bills: db.prepare("SELECT COUNT(*) as count FROM raw_bills").get().count,
    classifications: db.prepare("SELECT COUNT(*) as count FROM classifications").get().count,
    snapshots: db.prepare("SELECT COUNT(*) as count FROM state_snapshots WHERE published_flag = 1").get().count,
    exports: db.prepare("SELECT COUNT(*) as count FROM exports").get().count
  };

  const latestRun = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get();
  const missingStates = Math.max(0, EXPECTED_STATES - counts.snapshots);

  console.log("LiteSQL health summary");
  console.log(`Database: ${resolveDbPath()}`);
  console.log(`Runs: ${counts.runs}`);
  console.log(`Raw bills: ${counts.raw_bills}`);
  console.log(`Classifications: ${counts.classifications}`);
  console.log(`Published snapshots: ${counts.snapshots}`);
  console.log(`Exports: ${counts.exports}`);
  if (latestRun) {
    console.log(`Latest run started: ${latestRun.started_at}`);
    if (latestRun.completed_at) {
      console.log(`Latest run completed: ${latestRun.completed_at}`);
    }
  }

  if (missingStates > 0) {
    console.warn(`Warning: ${missingStates} state snapshots missing (expected ${EXPECTED_STATES}).`);
  } else {
    console.log("All expected state snapshots present.");
  }
}

main();
