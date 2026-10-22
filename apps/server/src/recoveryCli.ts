import { unpackPackage } from './backupPackages.ts';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runtimeDirectory } from './storage.ts';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { restoreRecoverySnapshot, validateRecoverySnapshot } from './recovery.ts';

async function control(command: string) {
  return new Promise<unknown>((accept, reject) => {
    const socket = createConnection(join(runtimeDirectory(process.env.DATA_DIR ?? '/data'), 'control.sock'));
    let input = '';
    socket.setTimeout(30 * 60_000, () => { socket.destroy(); reject(new Error('Recovery operation timed out')); });
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      if (input.length > 1024 * 1024) { socket.destroy(); reject(new Error('Recovery response exceeded its limit')); }
    });
    socket.on('end', () => {
      try { const result = JSON.parse(input); if (!result.ok) throw new Error(result.error); accept(result.result); }
      catch (error) { reject(error); }
    });
  });
}
async function main() {
  const [command, source, destination] = process.argv.slice(2);
  if (command === 'snapshot' || command === 'status') return control(command);
  let extracted: string | undefined;
  let snapshot = source;
  try {
    if ((command === 'verify' || command === 'restore') && source && statSync(source).isFile()) {
      extracted = mkdtempSync(join(tmpdir(), 'poketracker-restore-'));
      await unpackPackage(source, extracted); snapshot = extracted;
    }
    if (command === 'verify' && snapshot) {
      const manifest = await validateRecoverySnapshot(snapshot);
      return { verified: true, capturedAt: manifest.capturedAt, files: manifest.files.length };
    }
    if (command === 'restore' && snapshot && destination) return await restoreRecoverySnapshot(snapshot, destination);
    throw new Error('Usage: recovery.mjs snapshot | status | verify PACKAGE_OR_DIRECTORY | restore PACKAGE_OR_DIRECTORY NEW_DESTINATION');
  } finally { if (extracted) rmSync(extracted, { recursive: true, force: true }); }
}
main().then((result) => process.stdout.write(JSON.stringify(result) + '\n'), (error: Error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
