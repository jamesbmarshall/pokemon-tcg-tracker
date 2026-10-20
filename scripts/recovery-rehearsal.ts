/** Real encrypted Restic round trip followed by fresh-instance authentication and share access.
 * FULL_REHEARSAL=1 creates the agreed 50k-entry/5GiB profile. Run under host resource limits
 * to measure the deployment target; a laptop result is not an Azure RTO assertion. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as OTPAuth from 'otpauth';
import { startServer, setupOwner, personalId, Client, PASSWORD } from '../apps/server/test/helpers.ts';
import { createRecoverySnapshot, restoreRecoverySnapshot, validateRecoverySnapshot } from '../apps/server/src/recovery.ts';
import { putEntry, putGraded, savePhoto } from '../apps/server/src/collections.ts';
import { setPcKey } from '../apps/server/src/providers/pricecharting.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { Db } from '../apps/server/src/db.ts';
import { Sealer, validateInstanceSecrets } from '../apps/server/src/security.ts';
import { buildApp } from '../apps/server/src/app.ts';
const full = process.env.FULL_REHEARSAL === '1';
const entries = full ? 50_000 : 100;
const photoFiles = full ? 5120 : 2;
const restic = process.env.RESTIC_BIN ?? 'restic';
const work = mkdtempSync(join(tmpdir(), 'pt-rehearsal-'));
const env = { ...process.env, RESTIC_REPOSITORY: join(work, 'encrypted-repository'), RESTIC_PASSWORD_FILE: join(work, 'restic-password'), RESTIC_CACHE_DIR: join(work, 'cache') };
writeFileSync(env.RESTIC_PASSWORD_FILE!, randomBytes(32).toString('hex'), { mode: 0o600 });
const run = (args: string[], cwd = work) => execFileSync(restic, args, { env, cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const started = performance.now();
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('[]'); // Reference providers are synthetic, never live.
const server = await startServer();
let sourceClosed = false;
try {
  const owner = await setupOwner(server.app); const collection = await personalId(owner);
  const { secret } = (await owner.post('/api/account/totp/setup')).json();
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  assert.equal((await owner.post('/api/account/totp/enable', { code: totp.generate() })).statusCode, 200);
  setPcKey(server.ctx, 'synthetic-recovery-provider-key');
  await owner.post(`/api/collections/${collection}/lists`, { name: 'Recovery deck', kind: 'deck', format: 'standard' });
  server.ctx.db.tx(() => {
    for (let i = 1; i <= entries; i++) putEntry(server.ctx, collection, { id: `sv1-${i}::normal`, cardId: `sv1-${i}`, setId: 'sv1', variant: 'normal', quantity: 1, addedAt: new Date().toISOString() });
    putGraded(server.ctx, collection, { id: 'recovery-slab', cardId: 'sv1-1', setId: 'sv1', variant: 'normal', company: 'PSA', grade: '10', countsTowardSet: true, addedAt: new Date().toISOString() });
  });
  // Independent random bytes avoid measuring deduplication of repeated synthetic padding.
  for (let i = 0; i < photoFiles; i++) { const bytes = randomBytes(1024 * 1024); bytes.set([0xff, 0xd8, 0xff]); savePhoto(server.ctx, collection, 'recovery-slab', 'other', bytes); }
  const share = (await owner.post('/api/shares', { collectionId: collection, scope: 'collection', audience: 'public', hideValue: true, hidePaid: true })).json();
  const snapshotAt = performance.now(); const snapshot = await createRecoverySnapshot(server.ctx);
  const snapshotMs = performance.now() - snapshotAt;
  run(['init']); run(['backup', '.', '--tag', 'rehearsal', '--quiet'], snapshot.path);
  run(['check', '--read-data']);
  const destroyedAt = performance.now();
  await server.close(); sourceClosed = true; // Deletes the entire original host directory, including its key and local snapshots.
  const download = join(work, 'download'); run(['restore', 'latest', '--target', download, '--verify']);
  await validateRecoverySnapshot(download);
  const destination = join(work, 'fresh-instance'); await restoreRecoverySnapshot(download, destination);
  const db = new Db(join(destination, 'poketracker.db'));
  const sealer = new Sealer(Buffer.from(readFileSync(join(destination, 'secret.key'), 'utf8'), 'base64'));
  validateInstanceSecrets(db, sealer);
  const app = await buildApp({ db, sealer, config: loadConfig({ DATA_DIR: destination, JOBS: '0', LOG_LEVEL: 'silent', TCGDEX_BASE: 'http://synthetic.invalid/v2' }), log: console as never, services: {} }, { logger: false });
  try {
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n, 0);
    const client = new Client(app);
    assert.equal((await client.post('/api/auth/login', { username: 'ash', password: PASSWORD })).json().mfa, true);
    // Use the next accepted TOTP step: enrollment consumed the current step before capture.
    const code = totp.generate({ timestamp: Date.now() + 30_000 });
    assert.equal((await client.post('/api/auth/mfa', { code })).statusCode, 200);
    const state = (await client.get(`/api/collections/${collection}/state`)).json();
    assert.equal(state.entries.length, entries); assert.equal(state.lists[0].kind, 'deck');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM graded_photos')!.n, photoFiles);
    assert.equal(sealer.open(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'pricecharting_key'")!.value), 'synthetic-recovery-provider-key');
    const token = share.url.split('/s/')[1]; assert.ok(token);
    assert.equal((await app.inject(`/api/public/${token}`)).statusCode, 200);
    assert.ok(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM mutation_receipts')!.n > 0);
  } finally { await app.close(); db.close(); }
  const result = { profile: full ? '50000 entries / 5 GiB photos' : '100 entries / 2 MiB photos', restic: run(['version']).trim(), snapshotMs: Math.round(snapshotMs), restoreAndAuthenticationMs: Math.round(performance.now() - destroyedAt), totalMs: Math.round(performance.now() - started), platform: process.platform, architecture: process.arch, note: 'Local encrypted repository rehearsal; cloud bandwidth and fresh-host provisioning are not measured.' };
  if (process.env.REHEARSAL_REPORT) writeFileSync(process.env.REHEARSAL_REPORT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.restoreAndAuthenticationMs < 2 * 60 * 60_000, 'Recovery exceeded the two-hour target');
} finally { if (!sourceClosed) await server.close(); globalThis.fetch = previousFetch; rmSync(work, { recursive: true, force: true }); }
