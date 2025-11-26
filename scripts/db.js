const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "personhood.db");
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

let dbInstance;

function resolveDbPath() {
  const raw = process.env.LITESQL_URL || DEFAULT_DB_PATH;
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(__dirname, "..", raw);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}

function getDb() {
  if (dbInstance) return dbInstance;
  const filePath = resolveDbPath();
  dbInstance = new Database(filePath);
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("journal_mode = WAL");
  return dbInstance;
}

function ensureMigrationsTable(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function getAppliedMigrations(db) {
  const rows = db.prepare("SELECT name FROM migrations ORDER BY name").all();
  return new Set(rows.map((row) => row.name));
}

function applyMigrations() {
  const db = getDb();
  ensureMigrationsTable(db);
  const files = listMigrationFiles();
  const applied = getAppliedMigrations(db);

  const pending = files.filter((file) => !applied.has(file));
  if (!pending.length) return { applied: [] };

  const applyOne = db.transaction((file) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  });

  pending.forEach((file) => applyOne(file));
  return { applied: pending };
}

module.exports = {
  applyMigrations,
  getDb,
  resolveDbPath,
  MIGRATIONS_DIR
};
