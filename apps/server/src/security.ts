/**
 * Cryptographic primitives used across the server: random ids and tokens, constant-time
 * comparison, Argon2id password hashing, and AES-256-GCM sealing of secrets at rest.
 *
 * General pattern: bearer secrets that we only ever need to *check* (session cookies, invite and
 * reset links, recovery codes) are stored as SHA-256 hashes, so a leaked database can't be
 * replayed. Secrets we must read back (TOTP seeds, share links shown again to their owner) are
 * sealed with the instance key instead. High-entropy random tokens don't need a slow hash; only
 * human-chosen passwords go through Argon2id.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argon2id, argon2Verify } from 'hash-wasm';

/** URL-safe bearer secret. 32 bytes (256 bits) by default, which is far beyond guessable. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** Opaque row id. Random rather than sequential so ids in URLs don't reveal counts or order. */
export const newId = () => randomBytes(12).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/**
 * Redacts API-key-shaped query parameters (`t`, `token`, `key`, `api_key`) from any string that
 * might contain an upstream URL: log lines, thrown error messages, and anything persisted where
 * an admin or operator could read it back (job `last_error`, the audit log). Applied defensively
 * to free-form error text too, since some runtimes (e.g. fetch failures) echo the request URL
 * inside `Error#message` rather than a dedicated field.
 */
const SENSITIVE_QUERY_PARAM = /\b(t|token|key|api_key)=[^&\s"')]+/gi;
export function redactSecrets(input: string): string {
  return input.replace(SENSITIVE_QUERY_PARAM, (_, name: string) => `${name}=REDACTED`);
}

/**
 * Constant-time string comparison for secrets. Leaking the length is acceptable because callers
 * compare fixed-length hex digests.
 */
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * 32-byte instance key used to encrypt secrets at rest (TOTP seeds, share links).
 * Taken from SECRET_KEY (base64) if set, otherwise generated once into the data volume.
 * Losing or changing this key makes existing TOTP seeds unreadable and hides share URLs from
 * their owners, so back it up alongside the database. Setting SECRET_KEY keeps the key out of
 * the volume entirely, which helps when backups of the volume are less trusted than the host.
 */
export function loadInstanceKey(file: string, fromEnv?: string): Buffer {
  if (fromEnv) {
    const k = Buffer.from(fromEnv, 'base64');
    // Fail fast rather than silently running with a weak or truncated key.
    if (k.length !== 32) throw new Error('SECRET_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  if (existsSync(file)) {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length === 32) return k;
  }
  // Reached on first run, and also if the key file is unreadable as a 32-byte key (it is then overwritten).
  mkdirSync(dirname(file), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64'), { mode: 0o600 });
  // `mode` is ignored if the file already existed, so tighten permissions explicitly.
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on some mounts */
  }
  return k;
}

/**
 * Authenticated encryption for small secrets stored in the database. GCM means a tampered or
 * wrongly keyed value fails loudly on `open` instead of decrypting to garbage.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix leaves room to change
 * algorithm or key later without guessing what an old value is.
 */
export class Sealer {
  constructor(private key: Buffer) {}

  seal(plain: string): string {
    // Fresh 96-bit IV per value: reusing an IV under the same GCM key would break confidentiality.
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  /** Throws if the value was tampered with or sealed under a different key. */
  open(sealed: string): string {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1') throw new Error('Unknown sealed format');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  }
}

// OWASP 2024: Argon2id, m=19 MiB, t=2, p=1 (minimum). We go a little higher on memory.
// Kept modest because this runs on small home servers and every login pays the cost.
const ARGON = { parallelism: 1, iterations: 2, memorySize: 32 * 1024, hashLength: 32 };

/**
 * Returns a self-describing PHC string (algorithm, parameters, salt and hash), so the parameters
 * above can be raised later without breaking verification of existing hashes.
 * NFKC normalisation means the same password typed on different keyboards or OSes (e.g.
 * composed vs decomposed accents) hashes identically.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2id({ ...ARGON, password: password.normalize('NFKC'), salt: randomBytes(16), outputType: 'encoded' });
}

/** Never throws: a malformed stored hash is treated as a wrong password rather than a 500. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: password.normalize('NFKC'), hash });
  } catch {
    return false;
  }
}

/**
 * Used to equalise timing when the username doesn't exist. Without it, an unknown username
 * would return instantly while a real one pays for Argon2, letting anyone enumerate accounts.
 * The dummy hash is created lazily so startup stays fast, then reused.
 */
let dummyHash: Promise<string> | undefined;
export const dummyVerify = async (password: string) => {
  dummyHash ??= hashPassword(randomToken());
  await verifyPassword(password, await dummyHash);
  return false;
};

// Re-exported so server code has one import for password policy; the web client uses the same rules.
export { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '@poketracker/shared/accounts';
