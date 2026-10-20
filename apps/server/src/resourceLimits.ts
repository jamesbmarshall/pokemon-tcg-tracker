import { statfsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { HttpError, type Ctx } from './context.ts';
export const STORAGE_RESERVE = 128 * 1024 * 1024;
export const IMPORT_BYTES = 64 * 1024 * 1024;
/** Reserve remains available for WAL/checkpoint and error reporting; failures never acknowledge a write. */
export function assertStorage(ctx: Ctx, additionalBytes = 0, inspect: (path: string) => { bavail: number; bsize: number } = statfsSync) {
  const disk = inspect(ctx.config.dataDir);
  if (disk.bavail * disk.bsize < STORAGE_RESERVE + additionalBytes) throw new HttpError(507, 'Storage is too full to safely save this change. Free space or contact the host owner.', 'storage_full');
}
/** Parsing large JSON off the request thread keeps health and other collectors responsive.
 * The HTTP body cap, single-import admission, worker heap and deadline all bound the work. */
export function parseImportJson(body: string): Promise<unknown> {
  if (Buffer.byteLength(body) > IMPORT_BYTES) return Promise.reject(new HttpError(413, 'Import exceeds 64 MiB', 'import_limit'));
  return new Promise((resolve, reject) => {
    const code = `const { parentPort, workerData } = require('node:worker_threads'); try { parentPort.postMessage({ value: JSON.parse(workerData, (key, value) => { if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsafe property'); return value; }) }); } catch { parentPort.postMessage({ error: true }); }`;
    const worker = new Worker(code, { eval: true, workerData: body, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new HttpError(413, 'Import preparation exceeded its time limit', 'import_limit')); }, 10_000);
    worker.once('message', (result) => { clearTimeout(timer); if (result.error) reject(new HttpError(400, 'Invalid import JSON', 'import_invalid')); else resolve(result.value); void worker.terminate(); });
    worker.once('error', () => { clearTimeout(timer); reject(new HttpError(413, 'Import preparation exceeded its memory limit', 'import_limit')); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new HttpError(413, 'Import preparation stopped', 'import_limit')); });
  });
}
export async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) { await response.body?.cancel(); throw new Error('Upstream response too large'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > maximum) throw new Error('Upstream response too large'); parts.push(part.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(parts, bytes);
}
/** Structural preflight happens before legacy provider lookups, file creation or SQL. */
export function validateImportEnvelope(data: unknown) {
  if (!data || typeof data !== 'object') throw new HttpError(400, 'Import must be an object or legacy array', 'import_invalid');
  const obj = Array.isArray(data) ? { collection: data } : data as Record<string, unknown>;
  let rows = 0; let photoBytes = 0;
  for (const key of ['collection', 'graded', 'sealed', 'wishlist', 'notes', 'history', 'lists', 'photos', 'sealedPhotos']) {
    if (obj[key] === undefined) continue;
    if (!Array.isArray(obj[key])) throw new HttpError(400, `${key} must be an array`, 'import_invalid');
    const values = obj[key] as unknown[]; rows += values.length;
    if (values.length > (key === 'lists' ? 200 : 100_000)) throw new HttpError(413, `Too many ${key} records`, 'import_limit');
    if (key === 'photos' || key === 'sealedPhotos') for (const photo of values) {
      const encoded = JSON.stringify(photo);
      if (encoded.length > 16 * 1024 * 1024) throw new HttpError(413, 'An imported photo exceeds 12 MiB', 'import_limit');
      photoBytes += encoded.length;
    }
  }
  if (rows > 200_000 || photoBytes > 48 * 1024 * 1024) throw new HttpError(413, 'Import exceeds the record or photo budget; split it into smaller imports', 'import_limit');
}
