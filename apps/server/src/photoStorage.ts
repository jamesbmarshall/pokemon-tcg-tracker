import { assertStorage } from './resourceLimits.ts';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ctx } from './context.ts';
export type PhotoKind = 'photos' | 'sealed-photos';
const pins = new WeakMap<Ctx, Map<string, number>>();
const snapshots = new WeakMap<Ctx, number>();
/** An incremental backup may include photos added after it starts. Defer all orphan
 * deletion until its copied database and immutable files have both been captured. */
export function deferPhotoCleanup(ctx: Ctx) {
  snapshots.set(ctx, (snapshots.get(ctx) ?? 0) + 1);
  return () => { const count = snapshots.get(ctx)! - 1; if (count) snapshots.set(ctx, count); else snapshots.delete(ctx); };
}
const validId = (id: string) => /^[\w-]{1,64}$/.test(id);

export function publishPhoto(ctx: Ctx, kind: PhotoKind, id: string, bytes: Buffer) {
  assertStorage(ctx, bytes.length * 2);
  if (!validId(id)) throw new Error('Invalid photo identity');
  const dir = join(ctx.config.dataDir, kind);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const staged = join(dir, `.upload-${id}.tmp`);
  const fd = openSync(staged, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes); fsyncSync(fd);
    // Exclusive publication cannot overwrite bytes already associated with a photo ID.
    linkSync(staged, join(dir, id));
    const parent = openSync(dir, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { closeSync(fd); unlinkSync(staged); }
}

export function pinPhotos(ctx: Ctx, files: { kind: PhotoKind; id: string }[]) {
  if (files.some((file) => !validId(file.id))) throw new Error('Invalid photo ID in database; recovery snapshot aborted');
  let held = pins.get(ctx);
  if (!held) { held = new Map(); pins.set(ctx, held); }
  for (const file of files) {
    if (!validId(file.id)) throw new Error('Invalid photo ID in database; recovery snapshot aborted');
    const key = `${file.kind}/${file.id}`;
    held.set(key, (held.get(key) ?? 0) + 1);
  }
  return () => { for (const file of files) { const key = `${file.kind}/${file.id}`; const n = held!.get(key)! - 1; if (n) held!.set(key, n); else held!.delete(key); } };
}

/** A grace period protects interrupted imports and gives operators time to inspect damage.
 * Referenced files are never deleted, including files retained for soft-delete undo.
 */
export function reconcilePhotos(ctx: Ctx, graceMs = 86_400_000) {
  const missing: string[] = []; let removed = 0;
  for (const [kind, table] of [['photos', 'graded_photos'], ['sealed-photos', 'sealed_photos']] as const) {
    const referenced = new Set(ctx.db.all<{ id: string }>(`SELECT id FROM ${table}`).map((p) => p.id));
    if (kind === 'photos') for (const p of ctx.db.all<{ id: string }>('SELECT id FROM tcg_photos')) referenced.add(p.id);
    const dir = join(ctx.config.dataDir, kind);
    for (const id of referenced) if (!validId(id) || !existsSync(join(dir, id))) missing.push(`${kind}/${id}`);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !/^(?:[\w-]{1,64}|\.upload-[\w-]{1,64}\.tmp)$/.test(file.name)) continue;
      if (referenced.has(file.name) || snapshots.has(ctx) || pins.get(ctx)?.has(`${kind}/${file.name}`)) continue;
      const path = join(dir, file.name);
      if (Date.now() - statSync(path).mtimeMs >= graceMs) { unlinkSync(path); removed++; }
    }
  }
  return { missing, removed };
}
