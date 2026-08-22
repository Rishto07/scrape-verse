import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { CollectorConfig, HealthMetrics, HealEvent } from './schema.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'scrape-verse.db');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');

let db: any = null;
let dbInitialized = false;

export async function getDb(): Promise<any> {
  if (db && dbInitialized) return db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  let savedDb = null;
  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    savedDb = new SQL.Database(fileBuffer);
  } else {
    savedDb = new SQL.Database();
  }

  initSchema(savedDb);
  db = savedDb;
  dbInitialized = true;

  // Persist changes periodically
  setInterval(saveDb, 5000);
  process.on('exit', saveDb);
  process.on('SIGINT', () => { saveDb(); process.exit(0); });
  process.on('SIGTERM', () => { saveDb(); process.exit(0); });

  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[Store] Failed to persist DB:', err);
  }
}

function initSchema(database: any) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS collectors (
      id TEXT PRIMARY KEY,
      collector_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      description TEXT,
      expected_fields TEXT NOT NULL,
      thresholds TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collector_id TEXT NOT NULL,
      url TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      match_rate REAL NOT NULL,
      null_rate REAL NOT NULL,
      row_count INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      field_stats TEXT NOT NULL,
      FOREIGN KEY (collector_id) REFERENCES collectors(collector_id)
    );

    CREATE TABLE IF NOT EXISTS heal_events (
      id TEXT PRIMARY KEY,
      collector_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      trigger TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      diff TEXT,
      old_dom_hash TEXT,
      new_dom_hash TEXT,
      error TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (collector_id) REFERENCES collectors(collector_id)
    );

    CREATE INDEX IF NOT EXISTS idx_health_collector ON health_history(collector_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_heal_collector ON heal_events(collector_id, timestamp DESC);
  `);
}

// ============================================================
// Collector CRUD
// ============================================================

export function saveCollector(config: CollectorConfig): void {
  const database = getDbSync();
  database.run(`
    INSERT OR REPLACE INTO collectors
      (id, collector_id, name, target_url, description, expected_fields, thresholds, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    config.id,
    config.collectorId,
    config.name,
    config.targetUrl,
    config.description,
    JSON.stringify(config.expectedFields),
    config.thresholds ? JSON.stringify(config.thresholds) : null,
    config.createdAt,
    config.updatedAt,
  ]);
  saveDb();
}

export function getCollector(collectorId: string): CollectorConfig | null {
  const database = getDbSync();
  const stmt = database.prepare('SELECT * FROM collectors WHERE collector_id = ?');
  const row = stmt.getAsObject([collectorId]);
  stmt.free();
  if (!row || Object.keys(row).length === 0) return null;
  return rowToCollector(row as any);
}

export function getCollectorByName(name: string): CollectorConfig | null {
  const database = getDbSync();
  const stmt = database.prepare('SELECT * FROM collectors WHERE name = ?');
  const row = stmt.getAsObject([name]);
  stmt.free();
  if (!row || Object.keys(row).length === 0) return null;
  return rowToCollector(row as any);
}

export function listCollectors(): CollectorConfig[] {
  const database = getDbSync();
  const stmt = database.prepare('SELECT * FROM collectors ORDER BY name');
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToCollector);
}

function rowToCollector(row: any): CollectorConfig {
  let expectedFields: string[] = [];
  try {
    const parsed = row.expected_fields ? JSON.parse(row.expected_fields) : [];
    if (Array.isArray(parsed)) expectedFields = parsed;
  } catch {
    console.warn('[Store] Corrupt expected_fields for collector', row.collector_id, '— defaulting to []');
  }
  return {
    id: row.id,
    collectorId: row.collector_id,
    name: row.name,
    targetUrl: row.target_url,
    description: row.description,
    expectedFields,
    thresholds: row.thresholds ? JSON.parse(row.thresholds) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Health History
// ============================================================

export function saveHealthMetrics(metrics: HealthMetrics): void {
  const database = getDbSync();
  database.run(`
    INSERT INTO health_history
      (collector_id, url, timestamp, match_rate, null_rate, row_count, latency_ms, field_stats)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    metrics.collectorId,
    metrics.url,
    metrics.timestamp,
    metrics.matchRate,
    metrics.nullRate,
    metrics.rowCount,
    metrics.latencyMs,
    JSON.stringify(metrics.fieldStats),
  ]);
  saveDb();
}

export function getLatestHealth(collectorId: string): HealthMetrics | null {
  const database = getDbSync();
  const stmt = database.prepare(
    'SELECT * FROM health_history WHERE collector_id = ? ORDER BY timestamp DESC LIMIT 1'
  );
  const row = stmt.getAsObject([collectorId]);
  stmt.free();
  if (!row || Object.keys(row).length === 0) return null;
  return rowToHealth(row as any);
}

export function getHealthHistory(collectorId: string, limit = 50): HealthMetrics[] {
  const database = getDbSync();
  const stmt = database.prepare(
    'SELECT * FROM health_history WHERE collector_id = ? ORDER BY timestamp DESC LIMIT ?'
  );
  const rows: any[] = [];
  stmt.bind([collectorId, limit]);
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToHealth);
}

function rowToHealth(row: any): HealthMetrics {
  return {
    collectorId: row.collector_id,
    url: row.url,
    timestamp: row.timestamp,
    matchRate: row.match_rate,
    nullRate: row.null_rate,
    rowCount: row.row_count,
    latencyMs: row.latency_ms,
    fieldStats: row.field_stats ? JSON.parse(row.field_stats) : {},
  };
}

// ============================================================
// Heal Events
// ============================================================

export function saveHealEvent(event: HealEvent): void {
  const database = getDbSync();
  database.run(`
    INSERT OR REPLACE INTO heal_events
      (id, collector_id, timestamp, trigger, prompt, status, diff, old_dom_hash, new_dom_hash, error, duration_ms)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    event.id,
    event.collectorId,
    event.timestamp,
    event.trigger,
    event.prompt,
    event.status,
    event.diff ?? null,
    event.oldDomHash ?? null,
    event.newDomHash ?? null,
    event.error ?? null,
    event.durationMs ?? null,
  ]);
  saveDb();
}

export function getHealEvents(collectorId?: string, limit = 50): HealEvent[] {
  const database = getDbSync();
  const stmt = collectorId
    ? database.prepare('SELECT * FROM heal_events WHERE collector_id = ? ORDER BY timestamp DESC LIMIT ?')
    : database.prepare('SELECT * FROM heal_events ORDER BY timestamp DESC LIMIT ?');

  const rows: any[] = [];
  if (collectorId) {
    stmt.bind([collectorId, limit]);
  } else {
    stmt.bind([limit]);
  }
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToHealEvent);
}

function rowToHealEvent(row: any): HealEvent {
  return {
    id: row.id,
    collectorId: row.collector_id,
    timestamp: row.timestamp,
    trigger: row.trigger,
    prompt: row.prompt,
    status: row.status,
    diff: row.diff ? JSON.parse(row.diff) : undefined,
    oldDomHash: row.old_dom_hash ?? undefined,
    newDomHash: row.new_dom_hash ?? undefined,
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

// ============================================================
// DOM Snapshots (file-based)
// ============================================================

export function saveDomSnapshot(collectorId: string, html: string): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  const snapshotPath = path.join(SNAPSHOT_DIR, `${collectorId}.html`);
  writeFileSync(snapshotPath, html, 'utf-8');
}

export function getDomSnapshot(collectorId: string): string | null {
  const snapshotPath = path.join(SNAPSHOT_DIR, `${collectorId}.html`);
  if (!existsSync(snapshotPath)) return null;
  return readFileSync(snapshotPath, 'utf-8');
}

export function snapshotExists(collectorId: string): boolean {
  const snapshotPath = path.join(SNAPSHOT_DIR, `${collectorId}.html`);
  return existsSync(snapshotPath);
}

// ============================================================
// Utility
// ============================================================

import { randomUUID } from 'crypto';

export function generateId(): string {
  return randomUUID();
}

// Synchronous DB access (after initialization)
function getDbSync(): any {
  if (!db) throw new Error('Database not initialized. Call getDb() first.');
  return db;
}

// Ensure getDb() is called before sync access
let initPromise: Promise<any> | null = null;
export function initializeDb(): Promise<any> {
  if (!initPromise) {
    initPromise = getDb();
  }
  return initPromise;
}