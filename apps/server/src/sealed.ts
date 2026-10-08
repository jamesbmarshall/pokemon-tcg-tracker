/**
 * Sealed product tracking: booster boxes, ETBs and the like. Unlike single cards these aren't
 * catalogued upstream, so each item is free-form data the owner enters themselves, optionally
 * linked to a PriceCharting product for an automatic price.
 *
 * Mirrors the shape of graded.ts in collections.ts: a sanitiser that rebuilds a trusted object
 * field by field, CRUD routes under /api/collections/:id/sealed, and photo storage that mirrors
 * graded_photos. Opened items are kept (for history) but excluded from collection value.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPaid, NOTE_MAX } from '@poketracker/shared/value';
import type { SealedItem, SealedProductType } from '@poketracker/shared/types';
import { access } from './collections.ts';
import { audit, bad, forbidden, notFound, now, requireUser, str, type Ctx } from './context.ts';
import { newId } from './security.ts';
import { pcProduct, pcSealedPrice, pcConfigured } from './providers/pricecharting.ts';
import { sniffImage } from './collections.ts';

const PRODUCT_TYPES = new Set<SealedProductType>(['booster_box', 'etb', 'booster_bundle', 'tin', 'collection_box', 'blister', 'booster_pack', 'other']);
const SET_ID = /^(?:[a-z-]{2,5}:)?[A-Za-z0-9.-]{1,40}$/;
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : now());
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

function need(ctx: Ctx, req: FastifyRequest, level: 'read' | 'write'): { id: string } {
  const u = requireUser(req);
  const id = (req.params as { id: string }).id;
  const role = access(ctx, u.id, id);
  if (!role) throw notFound('Collection not found');
  if (level === 'write' && role === 'viewer') throw forbidden('You can view this collection but not change it');
  return { id };
}

/**
 * Turns untrusted client or import data into a well-formed sealed item, or undefined if it
 * can't be salvaged. pcProductId/pcPrice/pcUpdatedAt are only ever set by the link endpoint, but
 * are preserved here so a plain edit (which resends the whole object) doesn't drop them.
 */
export function cleanSealed(raw: unknown): SealedItem | undefined {
  const s = raw as Partial<SealedItem>;
  const name = str(s?.name, 100);
  if (!name || !PRODUCT_TYPES.has(s?.productType as SealedProductType)) return undefined;
  const quantity = Math.floor(Number(s?.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100_000) return undefined;
  const setId = typeof s?.setId === 'string' && SET_ID.test(s.setId) ? s.setId : undefined;
  return {
    id: typeof s?.id === 'string' && /^[\w-]{1,64}$/.test(s.id) ? s.id : newId(),
    name,
    productType: s!.productType as SealedProductType,
    setId,
    language: str(s?.language, 10) || undefined,
    quantity,
    paid: isPaid(s?.paid) ? { amount: s!.paid!.amount, currency: s!.paid!.currency } : undefined,
    valueUsd: num(s?.valueUsd, 0, 10_000_000),
    notes: typeof s?.notes === 'string' ? s.notes.trim().slice(0, NOTE_MAX) || undefined : undefined,
    pcProductId: typeof s?.pcProductId === 'string' ? s.pcProductId.slice(0, 64) : undefined,
    pcPrice: num(s?.pcPrice, 0, 10_000_000),
    pcUpdatedAt: typeof s?.pcUpdatedAt === 'string' ? s.pcUpdatedAt : undefined,
    status: s?.status === 'opened' ? 'opened' : 'sealed',
    openedAt: s?.status === 'opened' ? iso(s?.openedAt) : undefined,
    addedAt: iso(s?.addedAt),
    updatedAt: s?.updatedAt ? iso(s.updatedAt) : undefined,
  };
}

export function putSealed(ctx: Ctx, collectionId: string, s: SealedItem) {
  ctx.db.run(
    `INSERT OR REPLACE INTO sealed (collection_id, id, name, product_type, set_id, language, quantity, paid, value_override, pc_product_id, pc_price, pc_updated_at, status, opened_at, notes, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    collectionId,
    s.id,
    s.name,
    s.productType,
    s.setId ?? null,
    s.language ?? null,
    s.quantity,
    s.paid ? JSON.stringify(s.paid) : null,
    s.valueUsd != null ? JSON.stringify(s.valueUsd) : null,
    s.pcProductId ?? null,
    s.pcPrice ?? null,
    s.pcUpdatedAt ?? null,
    s.status,
    s.openedAt ?? null,
    s.notes ?? null,
    s.addedAt,
    s.updatedAt ?? null,
  );
}

interface SealedRow {
  id: string;
  name: string;
  product_type: SealedProductType;
  set_id: string | null;
  language: string | null;
  quantity: number;
  paid: string | null;
  value_override: string | null;
  pc_product_id: string | null;
  pc_price: number | null;
  pc_updated_at: string | null;
  status: 'sealed' | 'opened';
  opened_at: string | null;
  notes: string | null;
  added_at: string;
  updated_at: string | null;
}

const rowToSealed = (r: SealedRow): SealedItem => ({
  id: r.id,
  name: r.name,
  productType: r.product_type,
  ...(r.set_id ? { setId: r.set_id } : {}),
  ...(r.language ? { language: r.language } : {}),
  quantity: r.quantity,
  ...(r.paid ? { paid: JSON.parse(r.paid) } : {}),
  ...(r.value_override ? { valueUsd: JSON.parse(r.value_override) } : {}),
  ...(r.pc_product_id ? { pcProductId: r.pc_product_id } : {}),
  ...(r.pc_price != null ? { pcPrice: r.pc_price } : {}),
  ...(r.pc_updated_at ? { pcUpdatedAt: r.pc_updated_at } : {}),
  status: r.status,
  ...(r.opened_at ? { openedAt: r.opened_at } : {}),
  ...(r.notes ? { notes: r.notes } : {}),
  addedAt: r.added_at,
  ...(r.updated_at ? { updatedAt: r.updated_at } : {}),
});

export function readSealed(ctx: Ctx, collectionId: string): SealedItem[] {
  return ctx.db.all<SealedRow>('SELECT * FROM sealed WHERE collection_id = ? ORDER BY added_at', collectionId).map(rowToSealed);
}

// ---------------------------------------------------------------- photos (mirrors graded_photos)

const photoDir = (ctx: Ctx) => join(ctx.config.dataDir, 'sealed-photos');

export function saveSealedPhoto(ctx: Ctx, collectionId: string, sealedId: string, buf: Buffer) {
  const mime = sniffImage(buf);
  if (!mime) throw bad('That file is not a supported image');
  const id = newId();
  mkdirSync(photoDir(ctx), { recursive: true });
  writeFileSync(join(photoDir(ctx), id), buf);
  ctx.db.run('INSERT INTO sealed_photos (id, collection_id, sealed_id, mime, size, added_at) VALUES (?, ?, ?, ?, ?, ?)', id, collectionId, sealedId, mime, buf.length, now());
  return { id, mime };
}

export function deleteSealedPhotoFiles(ctx: Ctx, ids: string[]) {
  for (const id of ids) rmSync(join(photoDir(ctx), id), { force: true });
}

export function streamSealedPhoto(ctx: Ctx, collectionId: string, photoId: string) {
  const p = ctx.db.get<{ id: string; mime: string }>('SELECT id, mime FROM sealed_photos WHERE id = ? AND collection_id = ?', photoId, collectionId);
  const file = p && join(photoDir(ctx), p.id);
  if (!p || !file || !existsSync(file)) throw notFound('Photo not found');
  return { mime: p.mime, stream: createReadStream(file) };
}

export const sealedPhotosFor = (ctx: Ctx, collectionId: string, sealedId: string) =>
  ctx.db.all<{ id: string; added_at: string }>('SELECT id, added_at FROM sealed_photos WHERE collection_id = ? AND sealed_id = ? ORDER BY added_at', collectionId, sealedId).map((p) => ({ id: p.id, addedAt: p.added_at }));

// ---------------------------------------------------------------- PriceCharting refresh

/** Refreshes pc_price for every sealed item linked to a PriceCharting product. Used by the 'prices' job. */
export async function refreshSealedPrices(ctx: Ctx): Promise<number> {
  if (!pcConfigured(ctx)) return 0;
  const rows = ctx.db.all<{ collection_id: string; id: string; pc_product_id: string }>("SELECT collection_id, id, pc_product_id FROM sealed WHERE pc_product_id IS NOT NULL");
  let refreshed = 0;
  for (const r of rows) {
    try {
      const product = await pcProduct(ctx, r.pc_product_id);
      const price = pcSealedPrice(product);
      if (price != null) {
        ctx.db.run('UPDATE sealed SET pc_price = ?, pc_updated_at = ? WHERE collection_id = ? AND id = ?', price, now(), r.collection_id, r.id);
        refreshed++;
      }
    } catch (err) {
      ctx.log.warn({ err, id: r.id }, 'sealed price refresh failed');
    }
  }
  return refreshed;
}

export function sealedRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/collections/:id/sealed', async (req) => {
    const { id } = need(ctx, req, 'read');
    return readSealed(ctx, id);
  });

  app.put('/api/collections/:id/sealed/:sid', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { sid } = req.params as { sid: string };
    const item = cleanSealed({ ...(req.body as object), id: sid });
    if (!item || item.id !== sid) throw bad('That sealed item is invalid');
    putSealed(ctx, id, item);
    audit(ctx, req, 'sealed.saved', id, { sealedId: sid });
    return item;
  });

  app.delete('/api/collections/:id/sealed/:sid', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { sid } = req.params as { sid: string };
    const photos = ctx.db.all<{ id: string }>('SELECT id FROM sealed_photos WHERE collection_id = ? AND sealed_id = ?', id, sid).map((p) => p.id);
    ctx.db.run('DELETE FROM sealed WHERE collection_id = ? AND id = ?', id, sid);
    ctx.db.run('DELETE FROM sealed_photos WHERE collection_id = ? AND sealed_id = ?', id, sid);
    deleteSealedPhotoFiles(ctx, photos);
    audit(ctx, req, 'sealed.deleted', id, { sealedId: sid });
    return { ok: true };
  });

  /** Marks an item opened (excluding it from value) without deleting its history. */
  app.post('/api/collections/:id/sealed/:sid/open', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { sid } = req.params as { sid: string };
    const row = ctx.db.get<SealedRow>('SELECT * FROM sealed WHERE collection_id = ? AND id = ?', id, sid);
    if (!row) throw notFound('Sealed item not found');
    ctx.db.run("UPDATE sealed SET status = 'opened', opened_at = ? WHERE collection_id = ? AND id = ?", now(), id, sid);
    return rowToSealed({ ...row, status: 'opened', opened_at: now() });
  });

  app.get('/api/collections/:id/sealed/:sid/photos', async (req) => {
    const { id } = need(ctx, req, 'read');
    return sealedPhotosFor(ctx, id, (req.params as { sid: string }).sid);
  });

  app.post('/api/collections/:id/sealed/:sid/photos', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { sid } = req.params as { sid: string };
    if (!ctx.db.get('SELECT 1 FROM sealed WHERE collection_id = ? AND id = ?', id, sid)) throw notFound('Save the sealed item first');
    const out = [];
    for await (const part of req.files()) out.push(saveSealedPhoto(ctx, id, sid, await part.toBuffer()));
    return out;
  });

  app.get('/api/collections/:id/photos/sealed/:pid', async (req, reply) => {
    const { id } = need(ctx, req, 'read');
    const { mime, stream } = streamSealedPhoto(ctx, id, (req.params as { pid: string }).pid);
    reply.header('cache-control', 'private, max-age=31536000, immutable').type(mime);
    return reply.send(stream);
  });

  app.delete('/api/collections/:id/photos/sealed/:pid', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { pid } = req.params as { pid: string };
    const res = ctx.db.run('DELETE FROM sealed_photos WHERE id = ? AND collection_id = ?', pid, id);
    if (res.changes) deleteSealedPhotoFiles(ctx, [pid]);
    return { ok: true };
  });

  /** Links a sealed item to a PriceCharting product and fetches its price straight away. */
  app.post('/api/collections/:id/sealed/:sid/link', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { sid } = req.params as { sid: string };
    const row = ctx.db.get<SealedRow>('SELECT * FROM sealed WHERE collection_id = ? AND id = ?', id, sid);
    if (!row) throw notFound('Sealed item not found');
    const pid = str((req.body as { pcProductId?: unknown })?.pcProductId, 64);
    if (!pid) throw bad('Pick a product to link');
    const product = await pcProduct(ctx, pid);
    const price = pcSealedPrice(product);
    const at = now();
    ctx.db.run('UPDATE sealed SET pc_product_id = ?, pc_price = ?, pc_updated_at = ? WHERE collection_id = ? AND id = ?', pid, price ?? null, at, id, sid);
    return rowToSealed({ ...row, pc_product_id: pid, pc_price: price ?? null, pc_updated_at: at });
  });
}
