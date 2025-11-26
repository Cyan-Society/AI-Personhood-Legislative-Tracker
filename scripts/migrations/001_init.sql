PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  search_query TEXT,
  gemini_model TEXT,
  force_review_flag INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS raw_bills (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  change_hash TEXT,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classifications (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  raw_bill_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  summary TEXT,
  rationale TEXT,
  citation TEXT,
  source_url TEXT,
  relevance_flag INTEGER NOT NULL DEFAULT 0,
  reviewer TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (raw_bill_id) REFERENCES raw_bills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS state_snapshots (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  state_code TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT,
  citation TEXT,
  source_url TEXT,
  published_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS state_snapshot_bills (
  id INTEGER PRIMARY KEY,
  state_snapshot_id INTEGER NOT NULL,
  raw_bill_id INTEGER NOT NULL,
  FOREIGN KEY (state_snapshot_id) REFERENCES state_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (raw_bill_id) REFERENCES raw_bills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY,
  run_id INTEGER,
  export_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_bills_run ON raw_bills(run_id);
CREATE INDEX IF NOT EXISTS idx_classifications_run ON classifications(run_id);
CREATE INDEX IF NOT EXISTS idx_classifications_raw_bill ON classifications(raw_bill_id);
CREATE INDEX IF NOT EXISTS idx_state_snapshots_run ON state_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_exports_run ON exports(run_id);
