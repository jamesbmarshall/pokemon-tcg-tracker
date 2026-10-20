import { createServer } from 'node:net';
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from './context.ts';
import { createRecoverySnapshot, snapshotRunning } from './recovery.ts';

export function recoveryStatus(ctx: Ctx) {
  const path = join(ctx.config.dataDir, 'recovery-status.json');
  let remote: unknown = null;
  if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).size < 64 * 1024) {
    try { remote = JSON.parse(readFileSync(path, 'utf8')); } catch { /* invalid status is not success */ }
  }
  return { snapshotRunning: snapshotRunning(ctx), remote };
}

/** Local OS authority only: no listener on TCP and no cloud credentials in the application. */
export async function startRecoveryControl(ctx: Ctx) {
  const path = join(ctx.config.dataDir, 'control.sock');
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('control.sock exists and is not a socket; refusing to replace it');
    unlinkSync(path);
  }
  let work: Promise<unknown> | undefined;
  const server = createServer((socket) => {
    let input = ''; let handled = false;
    socket.setTimeout(30 * 60_000, () => socket.destroy());
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      if (handled) return;
      input += chunk.toString('utf8');
      if (input.length > 4096) { handled = true; socket.destroy(); return; }
      if (!input.includes('\n')) return;
      handled = true;
      let command: string;
      try { command = JSON.parse(input).command; } catch { socket.end(JSON.stringify({ ok: false, error: 'Invalid command' }) + '\n'); return; }
      if (ctx.services.isStopping?.()) { socket.end(JSON.stringify({ ok: false, error: 'Server is stopping' }) + '\n'); return; }
      const send = (result: unknown) => socket.end(JSON.stringify({ ok: true, result }) + '\n');
      if (command === 'status') { send(recoveryStatus(ctx)); return; }
      if (command !== 'snapshot' || work) { socket.end(JSON.stringify({ ok: false, error: 'Unknown command or snapshot already running' }) + '\n'); return; }
      const current = createRecoverySnapshot(ctx);
      work = current;
      void current.then(send, (error: Error) => socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n')).finally(() => { if (work === current) work = undefined; });
    });
  });
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(path, () => { server.removeListener('error', reject); accept(); }); });
  chmodSync(path, 0o600);
  return async () => {
    await work?.catch(() => undefined);
    await new Promise<void>((accept, reject) => server.close((err) => err ? reject(err) : accept()));
    if (existsSync(path)) unlinkSync(path);
  };
}
