const { test, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Set the environment variable BEFORE requiring the db script
// using a unique path to avoid conflicts
const TEST_DB_PATH = path.resolve(__dirname, "test.db");
process.env.LITESQL_URL = TEST_DB_PATH;

const { applyMigrations, getDb } = require("../scripts/db");

describe("Database Migrations", () => {
  
  // Cleanup after tests
  after(() => {
    const db = getDb();
    if (db.open) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // Also clean up the wal/shm files if they exist (WAL mode)
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
  });

  test("should create the database file", () => {
    // Triggers DB creation
    getDb(); 
    assert.ok(fs.existsSync(TEST_DB_PATH), "Database file should exist");
  });

  test("should apply migrations successfully", () => {
    const { applied } = applyMigrations();
    assert.ok(Array.isArray(applied), "Should return an array of applied migrations");
    assert.ok(applied.includes("001_init.sql"), "Should have applied 001_init.sql");
  });

  test("should have created the expected tables", () => {
    const db = getDb();
    // helper to check if table exists
    const tableExists = (name) => {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
      return !!row;
    };

    assert.ok(tableExists("migrations"), "migrations table should exist");
    assert.ok(tableExists("runs"), "runs table should exist");
    assert.ok(tableExists("raw_bills"), "raw_bills table should exist");
    assert.ok(tableExists("classifications"), "classifications table should exist");
    assert.ok(tableExists("state_snapshots"), "state_snapshots table should exist");
  });

  test("migrations should be idempotent (second run does nothing)", () => {
    const { applied } = applyMigrations();
    assert.strictEqual(applied.length, 0, "Should not apply any migrations on second run");
  });
});
