import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;
let dbType = null; // 'better-sqlite3' | 'node:sqlite'

/**
 * Initializes and returns the SQLite database connection.
 * Uses better-sqlite3 with an automated fallback to node:sqlite (Node built-in)
 * to ensure bulletproof compatibility across Node 20, 22, and 24.
 */
export function getDb(customPath = null) {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbFilePath = customPath || path.join(dbDir, 'baton.db');

  try {
    // 1. Try better-sqlite3 first
    const Database = require('better-sqlite3');
    dbInstance = new Database(dbFilePath);
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('journal_mode = WAL');
    dbType = 'better-sqlite3';
  } catch (err) {
    // 2. Fallback to Node's built-in node:sqlite DatabaseSync
    try {
      const { DatabaseSync } = require('node:sqlite');
      const syncDb = new DatabaseSync(dbFilePath);
      syncDb.exec('PRAGMA foreign_keys = ON;');
      syncDb.exec('PRAGMA journal_mode = WAL;');

      // Wrap syncDb to provide identical better-sqlite3 compatible API
      dbInstance = createNodeSqliteWrapper(syncDb);
      dbType = 'node:sqlite';
    } catch (innerErr) {
      throw new Error(`Failed to initialize SQLite database: ${err.message} / ${innerErr.message}`);
    }
  }

  initTables(dbInstance);
  return dbInstance;
}

function createNodeSqliteWrapper(syncDb) {
  return {
    exec(sql) {
      return syncDb.exec(sql);
    },
    pragma(pragmaStr) {
      return syncDb.exec(`PRAGMA ${pragmaStr};`);
    },
    prepare(sql) {
      const stmt = syncDb.prepare(sql);
      return {
        run(...params) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const result = stmt.run(...flatParams);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid
          };
        },
        get(...params) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return stmt.get(...flatParams);
        },
        all(...params) {
          const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return stmt.all(...flatParams);
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        syncDb.exec('BEGIN');
        try {
          const res = fn(...args);
          syncDb.exec('COMMIT');
          return res;
        } catch (e) {
          syncDb.exec('ROLLBACK');
          throw e;
        }
      };
    },
    close() {
      return syncDb.close();
    }
  };
}

/**
 * Creates schema tables if they don't exist.
 */
function initTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      access_label TEXT NOT NULL DEFAULT 'team',
      raw_content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      author TEXT,
      timestamp TEXT,
      text TEXT NOT NULL,
      access_label TEXT NOT NULL DEFAULT 'team',
      line_ref TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'Unverified',
      review_state TEXT NOT NULL DEFAULT 'pending',
      version INTEGER DEFAULT 1,
      gap_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claim_evidence (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      quote TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
      reviewer TEXT NOT NULL,
      status_decision TEXT NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_num INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS acknowledgements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_role TEXT NOT NULL,
      acknowledged_at TEXT DEFAULT (datetime('now')),
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sources_project_id ON sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_claims_project_id ON claims(project_id);
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim_id ON claim_evidence(claim_id);
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_chunk_id ON claim_evidence(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_claim_id ON reviews(claim_id);
    CREATE INDEX IF NOT EXISTS idx_versions_project_id ON versions(project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_project_id ON audit_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_acknowledgements_project_id ON acknowledgements(project_id);
  `);

  // Ensure gap_note column exists if table was created in prior schema
  try {
    db.exec('ALTER TABLE claims ADD COLUMN gap_note TEXT;');
  } catch (e) {
    // Column already exists
  }
}

export function getDbType() {
  return dbType;
}

export default getDb;
