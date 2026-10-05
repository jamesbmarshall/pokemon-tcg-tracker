import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoUpdateBlockedFor, compareVersions, verifyBundle } from '../src/updater.ts';
import type { Ctx } from '../src/context.ts';

describe('compareVersions', () => {
  it('orders semver including prereleases', () => {
    expect(compareVersions('2.1.0', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('10.0.0', '9.9.9')).toBeGreaterThan(0);
  });
});

describe('verifyBundle', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const bundle = Buffer.from('pretend tarball');
  const sum = `${createHash('sha256').update(bundle).digest('hex')}  poketracker-2.1.0.tar.gz\n`;
  const sig = sign(null, bundle, privateKey).toString('base64');

  it('accepts a correctly signed bundle', () => {
    expect(() => verifyBundle(pem, bundle, sum, sig)).not.toThrow();
  });

  it('rejects a tampered bundle', () => {
    expect(() => verifyBundle(pem, Buffer.from('evil tarball'), sum, sig)).toThrow(/Checksum/);
  });

  it('rejects a bundle signed by another key even with a matching checksum', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(() => verifyBundle(pem, bundle, sum, sign(null, bundle, other).toString('base64'))).toThrow(/Signature/);
  });
});

describe('autoUpdateBlockedFor', () => {
  const withState = (last: unknown, fn: (ctx: Ctx) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-upd-'));
    try {
      mkdirSync(join(dir, 'app'));
      if (last !== undefined) writeFileSync(join(dir, 'app', 'state.json'), JSON.stringify({ active: '2.0.0', last }));
      fn({ config: { dataDir: dir } } as unknown as Ctx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const at = new Date().toISOString();

  it('allows updates when there is no history', () => withState(undefined, (ctx) => expect(autoUpdateBlockedFor(ctx, '2.1.0')).toBe(false)));

  it('skips a version the owner rolled back from', () =>
    withState({ kind: 'rollback', ok: true, from: '2.1.0', to: '2.0.0', at }, (ctx) => {
      expect(autoUpdateBlockedFor(ctx, '2.1.0')).toBe(true);
      expect(autoUpdateBlockedFor(ctx, '2.2.0')).toBe(false);
    }));

  it('skips a version that failed its health check', () =>
    withState({ kind: 'update', ok: false, rolledBack: true, from: '2.0.0', to: '2.1.0', at }, (ctx) => {
      expect(autoUpdateBlockedFor(ctx, '2.1.0')).toBe(true);
      expect(autoUpdateBlockedFor(ctx, '2.1.1')).toBe(false);
    }));

  it('allows the version again once it was installed successfully', () =>
    withState({ kind: 'update', ok: true, from: '2.0.0', to: '2.1.0', at }, (ctx) => expect(autoUpdateBlockedFor(ctx, '2.1.0')).toBe(false)));
});
