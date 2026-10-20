import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInstanceKey, Sealer } from '../src/security.ts';

describe('instance key preservation', () => {
  it('creates once and never overwrites a corrupt existing key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-key-'));
    const file = join(dir, 'secret.key');
    try {
      const key = loadInstanceKey(file);
      expect(loadInstanceKey(file)).toEqual(key);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(new Sealer(key).open(new Sealer(key).seal('secret'))).toBe('secret');
      writeFileSync(file, 'truncated');
      expect(() => loadInstanceKey(file)).toThrow('Invalid instance key');
      expect(readFileSync(file, 'utf8')).toBe('truncated');
      expect(() => loadInstanceKey(file, 'bad')).toThrow('SECRET_KEY');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
