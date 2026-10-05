import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from '../src/config.ts';
import { Limiter } from '../src/context.ts';
import { Client, PASSWORD, setupOwner, startServer } from './helpers.ts';

describe('TRUST_PROXY', () => {
  it('is off unless asked for, so clients cannot pick their own IP', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('accepts true, a hop count or proxy addresses', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });
});

describe('Limiter', () => {
  it('treats ip:port as one client', () => {
    const l = new Limiter(2, 60_000);
    expect(l.take('203.0.113.5:1111')).toBe(true);
    expect(l.take('203.0.113.5:2222')).toBe(true);
    expect(l.take('203.0.113.5')).toBe(false);
    expect(l.take('203.0.113.6')).toBe(true);
  });
});

describe('client IP behind a proxy', () => {
  async function ipSeen(env: Record<string, string>) {
    const s = await startServer(env);
    try {
      await setupOwner(s.app);
      const c = new Client(s.app);
      await c.req('POST', '/api/auth/login', { username: 'ash', password: PASSWORD }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
      const sessions = (await c.get('/api/account/sessions')).json() as { current: boolean; ip: string }[];
      return sessions.find((x) => x.current)!.ip;
    } finally {
      await s.close();
    }
  }

  it('ignores X-Forwarded-For by default', async () => expect(await ipSeen({})).toBe('127.0.0.1'));
  it('with one trusted hop, takes the address the proxy saw, not the spoofed left-most one', async () =>
    expect(await ipSeen({ TRUST_PROXY: '1' })).toBe('203.0.113.9'));
});
