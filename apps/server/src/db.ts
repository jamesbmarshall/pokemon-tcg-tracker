/**
 * Thin synchronous wrapper over node:sqlite. The whole server shares one connection; SQLite is
 * fast enough for a household-sized instance and a single connection keeps transactions simple.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.ts';

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;
  /** Prepared statements keyed by SQL text. Callers pass constant SQL, so this stays small. */
  private stmts = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  /** See Config.journalMode for why network shares need 'delete'. */
  constructor(file: string, journalMode: 'wal' | 'delete' = 'wal') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    // journalMode is a closed union, so interpolating it cannot inject SQL.
    this.raw.exec(`PRAGMA journal_mode = ${journalMode === 'wal' ? 'WAL' : 'DELETE'};`);
    // foreign_keys is off by default in SQLite and is per connection, so it must be set here for
    // ON DELETE CASCADE to work. busy_timeout waits rather than failing straight away if another
    // process (an admin's sqlite3 shell, say) holds a lock. synchronous=NORMAL is the usual WAL
    // trade-off: safe against app crashes, may lose the last commit on power loss.
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  }

  private prep(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prep(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.prep(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.prep(sql).run(...params);
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  /**
   * Runs fn in a transaction (nested calls join the outer one). fn must be synchronous: an
   * await inside would let other requests run their writes inside this transaction.
   * IMMEDIATE takes the write lock up front so we never fail half-way on a lock upgrade.
   */
  tx<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Applies any migrations not yet recorded, each in its own transaction with its version row,
   * so a failure leaves the schema at the last good version. Versions are array positions,
   * which is why MIGRATIONS is append-only. Returns how many were applied.
   */
  migrate(): number {
    this.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    let applied = 0;
    for (const [i, sql] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (done.has(version)) continue;
      this.tx(() => {
        this.exec(sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, new Date().toISOString());
      });
      applied++;
    }
    return applied;
  }

  get schemaVersion(): number {
    return this.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')?.v ?? 0;
  }

  /**
   * Consistent online copy of the database. VACUUM INTO works while the server keeps serving,
   * folds in any WAL content and produces a single self-contained file, unlike copying the
   * .db file directly. It fails if the target exists, so callers use unique names.
   */
  backupTo(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.prep('VACUUM INTO ?').run(file);
  }

  close() {
    this.stmts.clear();
    this.raw.close();
  }
}

/** Parses a JSON column, returning fallback for NULL or corrupt values instead of throwing. */
export const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
