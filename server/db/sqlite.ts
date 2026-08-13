// ============================================================
// Energy Action Community — SQLite Persistence Module
//
// 本地单用户 SQLite（better-sqlite3）：
//   - 创建/打开 DB（懒加载单例）
//   - 初始化 schema（CREATE TABLE IF NOT EXISTS）
//   - transaction helper
//   - close（测试用）
//
// DB 文件：server/.data/energy-action.db（WAL 模式）
// 不做复杂 migration framework：clone 后首次运行自动建表。
// ============================================================

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let db: Database.Database | null = null

function dataDir(): string {
  // 从 server/db/ 向上回到 server/.data；测试可经 PERSONAL_AI_OS_DATA_DIR 重定向。
  return process.env.PERSONAL_AI_OS_DATA_DIR || join(import.meta.dirname, '..', '.data')
}

export function dbPath(): string {
  return join(dataDir(), 'energy-action.db')
}

function open(): Database.Database {
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  initSchema(database)
  return database
}

export function getDb(): Database.Database {
  if (!db) db = open()
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}

// ============================================================
// Schema
//
// 类型约定（SQLite 无原生类型系统，读取回 Domain 时恢复 TS 类型）：
//   Boolean  → INTEGER 0/1
//   日期时间 → ISO 8601 TEXT
//   Nullable → NULL
//   JSON     → TEXT（JSON.stringify / JSON.parse）
//
// 不使用 owner_id / users / auth_identities / RLS（本地单用户）。
// ============================================================

function initSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      project_id         TEXT,
      goal_id            TEXT,
      key_result_id      TEXT,
      column_id          TEXT,
      parent_task_id     TEXT,
      task_kind          TEXT,
      status             TEXT NOT NULL DEFAULT 'todo',
      user_priority      INTEGER,
      ai_priority_score  REAL NOT NULL DEFAULT 0,
      ai_priority_level  TEXT,
      ai_priority_reason TEXT NOT NULL DEFAULT '',
      due_date           TEXT,
      planned_date       TEXT,
      estimated_minutes  INTEGER NOT NULL DEFAULT 0,
      actual_minutes     INTEGER NOT NULL DEFAULT 0,
      cognitive_load     TEXT NOT NULL DEFAULT 'medium',
      energy_demand      INTEGER NOT NULL DEFAULT 3,
      recurrence_rule    TEXT,
      is_habit           INTEGER NOT NULL DEFAULT 0,
      completed_at       TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      deleted_at         TEXT,
      recycle_batch_id   TEXT
    );

    CREATE TABLE IF NOT EXISTS minimum_actions (
      id                TEXT PRIMARY KEY,
      task_id           TEXT NOT NULL,
      description       TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL DEFAULT 0,
      difficulty        INTEGER NOT NULL DEFAULT 1,
      ai_generated      INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'pending',
      completed_at      TEXT,
      created_at        TEXT NOT NULL,
      deleted_at        TEXT,
      recycle_batch_id  TEXT
    );

    CREATE TABLE IF NOT EXISTS task_decompositions (
      id               TEXT PRIMARY KEY,
      task_id          TEXT NOT NULL,
      status           TEXT NOT NULL,
      should_decompose INTEGER NOT NULL,
      original_input   TEXT NOT NULL,
      original_output  TEXT NOT NULL,
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      goal_id       TEXT,
      key_result_id TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      priority      INTEGER NOT NULL DEFAULT 0,
      start_date    TEXT,
      due_date      TEXT,
      progress      REAL NOT NULL DEFAULT 0,
      progress_mode TEXT NOT NULL DEFAULT 'task',
      color         TEXT,
      icon          TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      deleted_at    TEXT,
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id
      ON tasks(parent_task_id);

    CREATE INDEX IF NOT EXISTS idx_minimum_actions_task_id
      ON minimum_actions(task_id);

    CREATE INDEX IF NOT EXISTS idx_task_decompositions_task_id
      ON task_decompositions(task_id);
  `)
}
