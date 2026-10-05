/**
 * Runtime configuration, read once from environment variables at startup. Defaults suit the
 * container image; the launcher sets the variables that tie a process to its bundle
 * (WEB_DIR, APP_MANIFEST, POKETRACKER_LAUNCHER*).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Built SPA to serve; empty when running the API alone (dev / tests). */
  webDir: string;
  /** Public origin, e.g. https://cards.example.com. Used for invite/share links and origin checks. */
  publicUrl: string;
  trustProxy: boolean;
  version: string;
  /** Set by the launcher; self-update is only possible when it supervises us. */
  supervised: boolean;
  launcherVersion: string;
  githubRepo: string;
  /** GitHub REST API base; only changed for testing against a mock release feed. */
  githubApi: string;
  updatePublicKey: string;
  /** Optional pre-shared first-run token (e.g. supplied as a Deploy to Azure parameter). */
  setupToken: string;
  imageCacheMb: number;
  backupsToKeep: number;
  /**
   * 'wal' on local disks. 'delete' for network shares such as Azure Files (SMB): WAL relies on a
   * memory-mapped -shm file and byte-range locks that SMB does not honour reliably, which can
   * corrupt the database. Rollback journalling is slower but safe there.
   */
  journalMode: 'wal' | 'delete';
  logLevel: string;
  jobs: boolean;
  tcgdexBase: string;
  fxUrl: string;
}

/**
 * The bundle's manifest is the source of truth for our version, because /health reports it and
 * the launcher only accepts a new version once /health returns that exact string.
 */
function readVersion(): string {
  const candidates = [process.env.APP_MANIFEST, join(process.cwd(), 'manifest.json')].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).version;
    } catch {
      /* try next */
    }
  }
  return process.env.APP_VERSION ?? '0.0.0-dev';
}

/** The Ed25519 public key that release bundles must be signed with; the image bakes in a file. */
function readKey(): string {
  if (process.env.UPDATE_PUBLIC_KEY) return process.env.UPDATE_PUBLIC_KEY;
  const file = process.env.UPDATE_PUBLIC_KEY_FILE;
  return file && existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const bool = (v: string | undefined, dflt: boolean) => (v == null || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? './data'),
    webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : '',
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    // On by default because most installs sit behind a reverse proxy or Azure ingress.
    trustProxy: bool(env.TRUST_PROXY, true),
    version: readVersion(),
    supervised: env.POKETRACKER_LAUNCHER === '1',
    launcherVersion: env.POKETRACKER_LAUNCHER_VERSION ?? '',
    githubRepo: env.GITHUB_REPO ?? 'jamesbmarshall/pokemon-tcg-tracker',
    githubApi: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, ''),
    updatePublicKey: readKey(),
    setupToken: env.SETUP_TOKEN ?? '',
    imageCacheMb: Number(env.IMAGE_CACHE_MB ?? 2048),
    backupsToKeep: Number(env.BACKUPS_TO_KEEP ?? 7),
    // Anything other than an explicit 'delete' means WAL, so a typo can't produce an invalid PRAGMA.
    journalMode: env.SQLITE_JOURNAL_MODE === 'delete' ? 'delete' : 'wal',
    logLevel: env.LOG_LEVEL ?? 'info',
    jobs: bool(env.JOBS, true),
    tcgdexBase: env.TCGDEX_BASE ?? 'https://api.tcgdex.net/v2',
    fxUrl: env.FX_URL ?? 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,EUR',
  };
}
