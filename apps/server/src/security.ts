import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argon2id, argon2Verify } from 'hash-wasm';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const newId = () => randomBytes(12).toString('base64url');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * 32-byte instance key used to encrypt secrets at rest (TOTP seeds, share links).
 * Taken from SECRET_KEY (base64) if set, otherwise generated once into the data volume.
 */
export function loadInstanceKey(file: string, fromEnv?: string): Buffer {
  if (fromEnv) {
    const k = Buffer.from(fromEnv, 'base64');
    if (k.length !== 32) throw new Error('SECRET_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  if (existsSync(file)) {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length === 32) return k;
  }
  mkdirSync(dirname(file), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on some mounts */
  }
  return k;
}

export class Sealer {
  constructor(private key: Buffer) {}

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1') throw new Error('Unknown sealed format');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  }
}

// OWASP 2024: Argon2id, m=19 MiB, t=2, p=1 (minimum). We go a little higher on memory.
const ARGON = { parallelism: 1, iterations: 2, memorySize: 32 * 1024, hashLength: 32 };

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ ...ARGON, password: password.normalize('NFKC'), salt: randomBytes(16), outputType: 'encoded' });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: password.normalize('NFKC'), hash });
  } catch {
    return false;
  }
}

/** Used to equalise timing when the username doesn't exist. */
let dummyHash: Promise<string> | undefined;
export const dummyVerify = async (password: string) => {
  dummyHash ??= hashPassword(randomToken());
  await verifyPassword(password, await dummyHash);
  return false;
};

export { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '@poketracker/shared/accounts';
