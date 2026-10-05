import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareVersions, verifyBundle } from '../src/updater.ts';

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
