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
  /** Passed straight to Fastify: false, true, a hop count, or a comma-separated list of proxy IPs/CIDRs. */
  trustProxy: boolean | number | string;
  version: string;
  commit?: string;
  builtAt?: string;
  imageDigest?: string;
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
  /**
   * Read-only public demo: seeds a sample collection under a demo account and blocks mutations
   * except demo sign-in/out and shared catalogue-cache writes (see demo.ts). The scheduled
   * reset rebuilds the demo account's collections nightly. Use a dedicated data directory.
   */
  demoMode: boolean;
  /** How many days of per-card price history to keep; older rows are pruned by the cleanup job. */
  priceHistoryDays: number;
}

/**
 * The bundle's manifest is the source of truth for our version, because /health reports it and
 * the launcher only accepts a new version once /health returns that exact string.
 */
function readBuild(env: NodeJS.ProcessEnv): Pick<Config, 'version' | 'commit' | 'builtAt' | 'imageDigest'> {
  const candidates = [env.APP_MANIFEST, join(process.cwd(), 'manifest.json')].filter(Boolean) as string[];
  let manifest: Record<string, unknown> = {};
  for (const file of candidates) {
    try { manifest = JSON.parse(readFileSync(file, 'utf8')); break; }
    catch { /* standalone development may not have a build manifest */ }
  }
  return {
    version: typeof manifest.version === 'string' ? manifest.version : env.APP_VERSION ?? '0.0.0-dev',
    commit: typeof manifest.commit === 'string' && /^[a-f0-9]{40,64}$/.test(manifest.commit) ? manifest.commit : undefined,
    builtAt: typeof manifest.builtAt === 'string' && Number.isFinite(Date.parse(manifest.builtAt)) ? manifest.builtAt : undefined,
    imageDigest: env.APP_IMAGE_DIGEST && /^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(env.APP_IMAGE_DIGEST) ? env.APP_IMAGE_DIGEST : undefined,
  };
}

/** The Ed25519 public key that release bundles must be signed with; the image bakes in a file. */
function readKey(): string {
  if (process.env.UPDATE_PUBLIC_KEY) return process.env.UPDATE_PUBLIC_KEY;
  const file = process.env.UPDATE_PUBLIC_KEY_FILE;
  return file && existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const bool = (v: string | undefined, dflt: boolean) => {
  if (v == null || v === '') return dflt;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new Error(`Invalid boolean configuration value: ${v}`);
};

/**
 * TRUST_PROXY accepts true/false, a hop count ("1" = trust only the nearest proxy, so the
 * client IP is the address that proxy saw), or proxy addresses/CIDRs. A hop count or address
 * list is safer than `true`, which believes the left-most X-Forwarded-For entry and so lets a
 * client choose its own IP whenever the proxy appends rather than replaces the header.
 */
export function parseTrustProxy(v: string | undefined): boolean | number | string {
  const t = (v ?? '').trim();
  if (t === '' || /^(0|false|no|off)$/i.test(t)) return false;
  if (/^(true|yes|on)$/i.test(t)) return true;
  if (/^\d+$/.test(t)) return Number(t);
  return t;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config: Config = {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? './data'),
    webDir: env.WEB_DIR ? resolve(env.WEB_DIR) : '',
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    // Off by default: trusting X-Forwarded-For from the open internet lets anyone pick their own
    // IP and walk around the rate limits. The bundled deploys set it to 1 (one proxy hop).
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    ...readBuild(env),
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
    demoMode: bool(env.DEMO_MODE, false),
    priceHistoryDays: Number(env.PRICE_HISTORY_DAYS ?? 730),
  };
  for (const [name, value, min, max] of [
    ['PORT', config.port, 1, 65535], ['IMAGE_CACHE_MB', config.imageCacheMb, 0, 1_048_576],
    ['BACKUPS_TO_KEEP', config.backupsToKeep, 1, 3650], ['PRICE_HISTORY_DAYS', config.priceHistoryDays, 1, 36500],
  ] as const) if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  if (env.SQLITE_JOURNAL_MODE && !['wal', 'delete'].includes(env.SQLITE_JOURNAL_MODE)) throw new Error('SQLITE_JOURNAL_MODE must be wal or delete');
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(config.logLevel)) throw new Error('Invalid LOG_LEVEL');
  if (typeof config.trustProxy === 'number' && config.trustProxy > 32) throw new Error('TRUST_PROXY hop count is too large');
  if (config.publicUrl) {
    const url = new URL(config.publicUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== config.publicUrl) throw new Error('PUBLIC_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  return config;
}
