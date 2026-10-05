/**
 * Collections: the card data itself and who may touch it.
 *
 * Every user gets one 'personal' collection at signup and may create 'shared' ones that other
 * users join as editors or viewers. Per-collection access (owner/editor/viewer) is independent
 * of the instance role: an instance admin has no implicit access to anyone's cards.
 *
 * Also home to input sanitising for entries and graded slabs (also used by import), the
 * `collectionState` read model that both members and share visitors are served from, graded slab
 * photo storage, and JSON import/export for backups and migration from the old browser-only app.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setIdFromCardId } from '@poketracker/shared/catalog';
import { entryKey, GRADING_COMPANIES, isPaid, NOTE_MAX } from '@poketracker/shared/value';
import type { CardNote, CollectionEntry, GradedCopy, ValuePoint, WishlistEntry } from '@poketracker/shared/types';
import { audit, bad, forbidden, notFound, now, requireUser, str, type Ctx } from './context.ts';
import { hydrateMissing, readCards, readEntries, readGraded, readHistory, recordValue } from './cards.ts';
import { newId } from './security.ts';
import { migrateImport } from './legacy.ts';

export type Access = 'owner' | 'editor' | 'viewer';

export interface CollectionRow {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  owner_id: string;
  created_at: string;
}

/**
 * The caller's access to a collection, or null for none. Ownership comes from the collection row;
 * everyone else needs an explicit membership row. Null deliberately covers both "doesn't exist"
 * and "not yours" so callers can answer 404 in either case.
 */
export function access(ctx: Ctx, userId: string, collectionId: string): Access | null {
  const c = ctx.db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', collectionId);
  if (!c) return null;
  if (c.owner_id === userId) return 'owner';
  const m = ctx.db.get<{ role: Access }>('SELECT role FROM collection_members WHERE collection_id = ? AND user_id = ?', collectionId, userId);
  return m?.role ?? null;
}

/**
 * Route guard for `/api/collections/:id/...`. 'read' = any member, 'write' = owner or editor,
 * 'own' = owner only (rename, delete, membership, clear). Non-members get 404 rather than 403 so
 * collection ids can't be probed.
 */
function need(ctx: Ctx, req: FastifyRequest, level: 'read' | 'write' | 'own'): { id: string; role: Access } {
  const u = requireUser(req);
  const id = (req.params as { id: string }).id;
  const role = access(ctx, u.id, id);
  if (!role) throw notFound('Collection not found');
  if (level === 'write' && role === 'viewer') throw forbidden('You can view this collection but not change it');
  if (level === 'own' && role !== 'owner') throw forbidden('Only the collection owner can do that');
  return { id, role };
}

// ---------------------------------------------------------------- validation

// Card ids appear in URL paths (e.g. /wishlist/:cardId), so whitespace, slashes and URL delimiters are banned.
const CARD_ID = /^[^\s/\\?#]{1,100}$/;
const VARIANT = /^[A-Za-z0-9]{1,40}$/;
const CONDITIONS = new Set(['M', 'NM', 'LP', 'MP', 'HP', 'DMG']);
// Normalises client timestamps to ISO UTC. Unparseable input falls back to now rather than failing the save.
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : now());

function cardId(v: unknown): string {
  if (typeof v !== 'string' || !CARD_ID.test(v)) throw bad('Invalid card id');
  return v;
}

/**
 * Turns untrusted client or import data into a well-formed entry, or undefined if it can't be
 * salvaged. Builds a new object field by field, so unknown properties never reach the database.
 * The id and setId are derived from cardId/variant rather than trusted, which keeps one row per
 * card + variant and stops a client filing a card under the wrong set.
 */
export function cleanEntry(raw: unknown): CollectionEntry | undefined {
  const e = raw as Partial<CollectionEntry>;
  if (typeof e?.cardId !== 'string' || !CARD_ID.test(e.cardId) || typeof e.variant !== 'string' || !VARIANT.test(e.variant)) return undefined;
  const quantity = Math.floor(Number(e.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100_000) return undefined;
  return {
    id: entryKey(e.cardId, e.variant),
    cardId: e.cardId,
    setId: setIdFromCardId(e.cardId),
    variant: e.variant,
    quantity,
    condition: CONDITIONS.has(e.condition as string) ? e.condition : undefined,
    notes: typeof e.notes === 'string' ? e.notes.slice(0, NOTE_MAX) : undefined,
    paid: isPaid(e.paid) ? { amount: e.paid!.amount, currency: e.paid!.currency } : undefined,
    addedAt: iso(e.addedAt),
    updatedAt: e.updatedAt ? iso(e.updatedAt) : undefined,
  };
}

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

/**
 * Graded-slab equivalent of cleanEntry. Unlike entries, several slabs of the same card can
 * exist, so each keeps its own id; a well-formed client id is kept so the client's optimistic
 * copy, its photos and undo all refer to the same slab, otherwise a fresh one is minted.
 */
export function cleanGraded(raw: unknown): GradedCopy | undefined {
  const g = raw as Partial<GradedCopy>;
  if (typeof g?.cardId !== 'string' || !CARD_ID.test(g.cardId) || typeof g.variant !== 'string' || !VARIANT.test(g.variant)) return undefined;
  if (typeof g.grade !== 'string' || !g.grade.trim() || !GRADING_COMPANIES.has(g.company as string)) return undefined;
  const sub = g.subgrades && typeof g.subgrades === 'object' ? g.subgrades : undefined;
  const subgrades = sub
    ? Object.fromEntries((['centering', 'corners', 'edges', 'surface'] as const).flatMap((k) => (num(sub[k], 0, 10) !== undefined ? [[k, sub[k]]] : [])))
    : undefined;
  return {
    id: typeof g.id === 'string' && /^[\w-]{1,64}$/.test(g.id) ? g.id : newId(),
    cardId: g.cardId,
    setId: setIdFromCardId(g.cardId),
    variant: g.variant,
    company: g.company!,
    companyName: g.company === 'Other' ? str(g.companyName, 60) || undefined : undefined,
    grade: g.grade.trim().slice(0, 20),
    label: str(g.label, 60) || undefined,
    certNumber: str(g.certNumber, 40) || undefined,
    subgrades: subgrades && Object.keys(subgrades).length ? subgrades : undefined,
    countsTowardSet: g.countsTowardSet !== false,
    valueUsd: num(g.valueUsd, 0, 10_000_000),
    paid: isPaid(g.paid) ? { amount: g.paid!.amount, currency: g.paid!.currency } : undefined,
    notes: typeof g.notes === 'string' ? g.notes.trim().slice(0, NOTE_MAX) || undefined : undefined,
    addedAt: iso(g.addedAt),
    updatedAt: g.updatedAt ? iso(g.updatedAt) : undefined,
  };
}

function putEntry(ctx: Ctx, collectionId: string, e: CollectionEntry) {
  ctx.db.run(
    `INSERT OR REPLACE INTO entries (collection_id, id, card_id, set_id, variant, quantity, condition, notes, paid, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    collectionId,
    e.id,
    e.cardId,
    e.setId,
    e.variant,
    e.quantity,
    e.condition ?? null,
    e.notes ?? null,
    e.paid ? JSON.stringify(e.paid) : null,
    e.addedAt,
    e.updatedAt ?? null,
  );
}

// Writing a graded copy always clears deleted_at, which is how "Undo" after a soft delete restores it.
function putGraded(ctx: Ctx, collectionId: string, g: GradedCopy) {
  ctx.db.run('INSERT OR REPLACE INTO graded (collection_id, id, card_id, data, deleted_at) VALUES (?, ?, ?, ?, NULL)', collectionId, g.id, g.cardId, JSON.stringify(g));
}

// ---------------------------------------------------------------- read models

/** Collections the user owns or belongs to, personal first, with their effective access level. */
export function listCollections(ctx: Ctx, userId: string) {
  return ctx.db
    .all<CollectionRow & { role: string | null; owner_name: string }>(
      `SELECT c.*, CASE WHEN c.owner_id = ? THEN 'owner' ELSE m.role END AS role, u.display_name AS owner_name
         FROM collections c
         JOIN users u ON u.id = c.owner_id
         LEFT JOIN collection_members m ON m.collection_id = c.id AND m.user_id = ?
        WHERE c.owner_id = ? OR m.user_id IS NOT NULL
        ORDER BY c.kind = 'shared', c.created_at`,
      userId,
      userId,
      userId,
    )
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, role: c.role as Access, ownerName: c.owner_name, mine: c.owner_id === userId }));
}

export interface StateOptions {
  hidePaid?: boolean;
  hideNotes?: boolean;
  hideValue?: boolean;
}

/**
 * Everything the client needs to render a collection. Redaction is applied here for shares.
 *
 * Members call this with no options and see everything. Shares pass their privacy flags, and
 * the matching fields are removed before serialisation rather than left for the client to hide:
 *  - hidePaid: purchase prices on entries and slabs, plus cost-basis figures in value history.
 *  - hideValue: slab valuations, card market prices and the whole value history.
 *  - hideNotes: per-card notes and the notes field on entries and slabs.
 */
export function collectionState(ctx: Ctx, collectionId: string, opts: StateOptions = {}) {
  let entries = readEntries(ctx.db, collectionId);
  let graded = readGraded(ctx.db, collectionId);
  const wishlist = ctx.db.all<{ card_id: string; added_at: string }>('SELECT card_id, added_at FROM wishlist WHERE collection_id = ?', collectionId).map((w) => ({ cardId: w.card_id, addedAt: w.added_at }));
  const notes = opts.hideNotes ? [] : ctx.db.all<{ card_id: string; text: string; updated_at: string }>('SELECT * FROM notes WHERE collection_id = ?', collectionId).map((n) => ({ cardId: n.card_id, text: n.text, updatedAt: n.updated_at }));
  const lists = readLists(ctx, collectionId);
  if (opts.hidePaid || opts.hideNotes || opts.hideValue) {
    entries = entries.map((e) => ({ ...e, paid: opts.hidePaid ? undefined : e.paid, notes: opts.hideNotes ? undefined : e.notes }));
    graded = graded.map((g) => ({ ...g, paid: opts.hidePaid ? undefined : g.paid, notes: opts.hideNotes ? undefined : g.notes, valueUsd: opts.hideValue ? undefined : g.valueUsd }));
  }
  let history: ValuePoint[] = opts.hideValue ? [] : readHistory(ctx.db, collectionId);
  // Rebuild each point from an allow-list so costUsd / costedValueUsd (what the owner paid) are dropped.
  if (opts.hidePaid) history = history.map((p) => ({ date: p.date, valueUsd: p.valueUsd, cards: p.cards, unique: p.unique }));
  const ids = new Set([...entries.map((e) => e.cardId), ...graded.map((g) => g.cardId), ...wishlist.map((w) => w.cardId), ...lists.flatMap((l) => l.cards)]);
  let cards = Array.from(readCards(ctx.db, ids).values());
  // Card prices would let a visitor recompute the hidden total, so they go too.
  if (opts.hideValue) cards = cards.map((c) => ({ ...c, prices: {} }));
  // Set totals are shared catalogue data, not per-collection, so there is nothing private to filter.
  const setStats = ctx.db.all<{ set_id: string; master_total: number; synced_at: string }>('SELECT * FROM set_stats').map((s) => ({ setId: s.set_id, masterTotal: s.master_total, syncedAt: s.synced_at }));
  return { entries, graded, wishlist, notes, history, cards, setStats, lists };
}

export function readLists(ctx: Ctx, collectionId: string) {
  const lists = ctx.db.all<{ id: string; name: string; description: string | null; created_at: string; updated_at: string }>('SELECT * FROM lists WHERE collection_id = ? ORDER BY created_at', collectionId);
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description ?? undefined,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    cards: ctx.db.all<{ card_id: string }>('SELECT card_id FROM list_cards WHERE list_id = ? ORDER BY position, added_at', l.id).map((r) => r.card_id),
  }));
}

// Files are named by random photo id only, never by anything user-supplied, so there is no path traversal.
const photoDir = (ctx: Ctx) => join(ctx.config.dataDir, 'photos');

/**
 * Accept only images whose bytes actually look like an image.
 * The client's filename and Content-Type are ignored because both are trivially forged. The
 * sniffed type is what gets served back, and SVG is deliberately absent since it can carry script.
 */
export function sniffImage(buf: Buffer): string | undefined {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.subarray(4, 12).toString('ascii').startsWith('ftypheic') || buf.subarray(4, 12).toString('ascii').startsWith('ftypmif1')) return 'image/heic';
  return undefined;
}

/**
 * Stores a slab photo on disk and records it. Callers must already have checked write access
 * and that the graded copy belongs to this collection.
 */
export function savePhoto(ctx: Ctx, collectionId: string, gradedId: string, side: string, buf: Buffer) {
  const mime = sniffImage(buf);
  if (!mime) throw bad('That file is not a supported image');
  const id = newId();
  mkdirSync(photoDir(ctx), { recursive: true });
  writeFileSync(join(photoDir(ctx), id), buf);
  const s = ['front', 'back', 'other'].includes(side) ? side : 'other';
  ctx.db.run('INSERT INTO graded_photos (id, collection_id, graded_id, side, mime, size, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, collectionId, gradedId, s, mime, buf.length, now());
  return { id, side: s, mime };
}

/** Best effort: `force` makes already-missing files a no-op so cleanup can be retried safely. */
export function deletePhotoFiles(ctx: Ctx, ids: string[]) {
  for (const id of ids) rmSync(join(photoDir(ctx), id), { force: true });
}

/**
 * The collection id is part of the lookup so a photo id from one collection can't be fetched
 * through a route authorised for another.
 */
export function streamPhoto(ctx: Ctx, collectionId: string, photoId: string) {
  const p = ctx.db.get<{ id: string; mime: string }>('SELECT id, mime FROM graded_photos WHERE id = ? AND collection_id = ?', photoId, collectionId);
  const file = p && join(photoDir(ctx), p.id);
  if (!p || !file || !existsSync(file)) throw notFound('Photo not found');
  return { mime: p.mime, stream: createReadStream(file) };
}

export const photosFor = (ctx: Ctx, collectionId: string, gradedId: string) =>
  ctx.db.all<{ id: string; side: string; added_at: string }>('SELECT id, side, added_at FROM graded_photos WHERE collection_id = ? AND graded_id = ? ORDER BY added_at', collectionId, gradedId).map((p) => ({ id: p.id, side: p.side, addedAt: p.added_at }));

// ---------------------------------------------------------------- import

export interface ImportResult {
  entries: number;
  graded: number;
  wishlist: number;
  notes: number;
  history: number;
  photos: number;
  remapped: number;
}

/**
 * Merges a backup into a collection. Accepts current exports, older exports and the bare array
 * format from the original browser-only app. Everything goes through the same sanitisers as live
 * edits, invalid rows are skipped rather than failing the whole import, and the database writes
 * happen in one transaction.
 *
 * Merge semantics: entries, slabs, wishlist and notes overwrite matching rows; value history
 * only fills gaps. Card data and a fresh value snapshot are fetched afterwards in the background
 * so a large import returns promptly.
 */
export async function importInto(ctx: Ctx, collectionId: string, data: unknown): Promise<ImportResult> {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rawEntries: unknown[] = Array.isArray(data) ? data : Array.isArray(obj.collection) ? obj.collection : [];
  const rawWishlist: unknown[] = Array.isArray(obj.wishlist) ? obj.wishlist : [];
  const rawGraded: unknown[] = Array.isArray(obj.graded) ? obj.graded : [];
  const rawNotes: unknown[] = Array.isArray(obj.notes) ? obj.notes : [];
  const rawHistory: unknown[] = Array.isArray(obj.history) ? obj.history : [];
  const rawPhotos: unknown[] = Array.isArray(obj.photos) ? obj.photos : [];

  // Backups from the pokemontcg.io era use different ids; remap them first.
  const legacy = await migrateImport(ctx, rawEntries, rawWishlist);
  const remap = legacy.remap;

  const entries = new Map<string, CollectionEntry>();
  for (const r of rawEntries) {
    // Older exports could omit quantity (or write 0); the browser-only app treated those as one copy.
    const q = Math.floor(Number((r as { quantity?: unknown })?.quantity));
    const e = cleanEntry(remap(r && typeof r === 'object' ? { ...r, quantity: q >= 1 ? q : 1 } : r));
    if (!e) continue;
    const prev = entries.get(e.id);
    // The same card + variant can appear more than once in hand-edited files; sum rather than drop.
    entries.set(e.id, prev ? { ...prev, quantity: prev.quantity + e.quantity } : e);
  }
  const graded = rawGraded.map((g) => cleanGraded(remap(g))).filter((g): g is GradedCopy => !!g);
  const wishlist = rawWishlist
    .map((w) => remap(w) as Partial<WishlistEntry>)
    .filter((w) => typeof w?.cardId === 'string' && CARD_ID.test(w.cardId))
    .map((w) => ({ cardId: w.cardId!, addedAt: iso(w.addedAt) }));
  const notes = rawNotes
    .map((n) => n as Partial<CardNote>)
    .filter((n) => typeof n?.cardId === 'string' && CARD_ID.test(n.cardId) && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({ cardId: n.cardId!, text: n.text!.trim().slice(0, NOTE_MAX), updatedAt: iso(n.updatedAt) }));
  const history = rawHistory
    .map((p) => p as Partial<ValuePoint>)
    .filter((p) => typeof p?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && typeof p.valueUsd === 'number')
    .map((p) => ({
      date: p.date!,
      valueUsd: p.valueUsd!,
      cards: Number(p.cards) || 0,
      unique: Number(p.unique) || 0,
      ...(typeof p.costUsd === 'number' ? { costUsd: p.costUsd, costedValueUsd: Number(p.costedValueUsd) || 0 } : {}),
    }));

  if (!entries.size && !graded.length && !wishlist.length && !notes.length && !history.length) throw bad('No collection entries found in that file');

  let photos = 0;
  ctx.db.tx(() => {
    for (const e of entries.values()) putEntry(ctx, collectionId, e);
    for (const g of graded) putGraded(ctx, collectionId, g);
    for (const w of wishlist) ctx.db.run('INSERT OR REPLACE INTO wishlist (collection_id, card_id, added_at) VALUES (?, ?, ?)', collectionId, w.cardId, w.addedAt);
    for (const n of notes) ctx.db.run('INSERT OR REPLACE INTO notes (collection_id, card_id, text, updated_at) VALUES (?, ?, ?, ?)', collectionId, n.cardId, n.text, n.updatedAt);
    // Never overwrite days the server already recorded.
    for (const p of history) ctx.db.run('INSERT OR IGNORE INTO value_history (collection_id, date, data) VALUES (?, ?, ?)', collectionId, p.date, JSON.stringify(p));
    const gradedIds = new Set(graded.map((g) => g.id));
    for (const raw of rawPhotos) {
      const p = raw as { gradedId?: string; side?: string; dataUrl?: string };
      // Only attach photos to slabs from this same file, never to an existing slab chosen by id.
      if (!p?.gradedId || !gradedIds.has(p.gradedId) || typeof p.dataUrl !== 'string') continue;
      const m = /^data:image\/[a-z+]+;base64,(.+)$/.exec(p.dataUrl);
      if (!m) continue;
      try {
        savePhoto(ctx, collectionId, p.gradedId, p.side ?? 'other', Buffer.from(m[1], 'base64'));
        photos++;
      } catch {
        /* skip unreadable photo: savePhoto re-sniffs the decoded bytes rather than trusting the data URL's type */
      }
    }
  });
  void hydrateMissing(ctx, [...entries.values()].map((e) => e.cardId).concat(graded.map((g) => g.cardId), wishlist.map((w) => w.cardId))).then(() => recordValue(ctx, collectionId))
    .catch((err) => ctx.log.warn({ err }, 'post-import value snapshot failed'));
  return { entries: entries.size, graded: graded.length, wishlist: wishlist.length, notes: notes.length, history: history.length, photos, remapped: legacy.remapped };
}

// ---------------------------------------------------------------- routes

export function collectionRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/collections', async (req) => listCollections(ctx, requireUser(req).id));

  // Personal collections are created with the account (createUser); this only makes shared ones.
  app.post('/api/collections', async (req) => {
    const u = requireUser(req);
    const name = str((req.body as Record<string, unknown>)?.name, 60);
    if (!name) throw bad('Give the collection a name');
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM collections WHERE owner_id = ?', u.id)!.n;
    if (count >= 50) throw bad('You have too many collections');
    const id = newId();
    ctx.db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES (?, ?, 'shared', ?, ?)", id, name, u.id, now());
    audit(ctx, req, 'collection.created', id);
    return { id, name, kind: 'shared', role: 'owner', mine: true, ownerName: u.displayName };
  });

  app.patch('/api/collections/:id', async (req) => {
    const { id } = need(ctx, req, 'own');
    const name = str((req.body as Record<string, unknown>)?.name, 60);
    if (!name) throw bad('Give the collection a name');
    ctx.db.run('UPDATE collections SET name = ? WHERE id = ?', name, id);
    return { ok: true };
  });

  app.delete('/api/collections/:id', async (req) => {
    const { id } = need(ctx, req, 'own');
    const c = ctx.db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id)!;
    if (c.kind === 'personal') throw bad("Your personal collection can't be deleted");
    // Collect photo ids before the cascade removes their rows, then delete the files afterwards.
    const photos = ctx.db.all<{ id: string }>('SELECT id FROM graded_photos WHERE collection_id = ?', id).map((p) => p.id);
    ctx.db.run('DELETE FROM collections WHERE id = ?', id);
    deletePhotoFiles(ctx, photos);
    audit(ctx, req, 'collection.deleted', id);
    return { ok: true };
  });

  app.get('/api/collections/:id/members', async (req) => {
    const { id } = need(ctx, req, 'read');
    return ctx.db.all(
      `SELECT u.id, u.username, u.display_name AS displayName, m.role FROM collection_members m JOIN users u ON u.id = m.user_id WHERE m.collection_id = ? ORDER BY u.display_name`,
      id,
    );
  });

  /**
   * Adds or changes a member. Owner only, shared collections only: a personal collection stays
   * private to its owner and is shared via share links instead. Role defaults to editor.
   */
  app.put('/api/collections/:id/members/:userId', async (req) => {
    const { id } = need(ctx, req, 'own');
    const c = ctx.db.get<CollectionRow>('SELECT * FROM collections WHERE id = ?', id)!;
    if (c.kind === 'personal') throw bad('Create a shared collection to add members');
    const { userId } = req.params as { userId: string };
    const role = (req.body as Record<string, unknown>)?.role === 'viewer' ? 'viewer' : 'editor';
    if (userId === c.owner_id || !ctx.db.get('SELECT 1 FROM users WHERE id = ? AND disabled = 0', userId)) throw bad('Pick another user');
    ctx.db.run('INSERT OR REPLACE INTO collection_members (collection_id, user_id, role, added_at) VALUES (?, ?, ?, ?)', id, userId, role, now());
    audit(ctx, req, 'collection.member_set', id, { userId, role });
    return { ok: true };
  });

  app.delete('/api/collections/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const { id, userId } = req.params as { id: string; userId: string };
    const role = access(ctx, u.id, id);
    // Owners remove anyone; members can leave.
    if (!role || (role !== 'owner' && userId !== u.id)) throw forbidden();
    ctx.db.run('DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?', id, userId);
    audit(ctx, req, 'collection.member_removed', id, { userId });
    return { ok: true };
  });

  app.get('/api/collections/:id/state', async (req) => {
    const { id, role } = need(ctx, req, 'read');
    return { role, ...collectionState(ctx, id) };
  });

  // Bulk upsert so the client can save many changes in one request. All-or-nothing:
  // one bad entry rejects the batch, so the client never ends up half-saved.
  app.put('/api/collections/:id/entries', async (req) => {
    const { id } = need(ctx, req, 'write');
    const list = (req.body as { entries?: unknown[] })?.entries;
    if (!Array.isArray(list) || list.length > 5000) throw bad('Send 1–5000 entries');
    const clean = list.map(cleanEntry);
    if (clean.some((e) => !e)) throw bad('One or more entries are invalid');
    ctx.db.tx(() => clean.forEach((e) => putEntry(ctx, id, e!)));
    // Fire and forget: fetch catalogue data for any new cards without holding up the save.
    void hydrateMissing(ctx, clean.map((e) => e!.cardId));
    return { entries: clean };
  });

  app.post('/api/collections/:id/entries/delete', async (req) => {
    const { id } = need(ctx, req, 'write');
    const ids = (req.body as { ids?: unknown[] })?.ids;
    if (!Array.isArray(ids) || ids.length > 5000) throw bad('Send 1–5000 ids');
    ctx.db.tx(() => ids.forEach((e) => typeof e === 'string' && ctx.db.run('DELETE FROM entries WHERE collection_id = ? AND id = ?', id, e)));
    return { ok: true };
  });

  app.put('/api/collections/:id/wishlist/:cardId', async (req) => {
    const { id } = need(ctx, req, 'write');
    const card = cardId((req.params as { cardId: string }).cardId);
    const addedAt = iso((req.body as Record<string, unknown>)?.addedAt);
    ctx.db.run('INSERT OR REPLACE INTO wishlist (collection_id, card_id, added_at) VALUES (?, ?, ?)', id, card, addedAt);
    void hydrateMissing(ctx, [card]);
    return { cardId: card, addedAt };
  });

  app.delete('/api/collections/:id/wishlist/:cardId', async (req) => {
    const { id } = need(ctx, req, 'write');
    ctx.db.run('DELETE FROM wishlist WHERE collection_id = ? AND card_id = ?', id, (req.params as { cardId: string }).cardId);
    return { ok: true };
  });

  // Saving empty text deletes the note, so the client needs only one endpoint for both.
  app.put('/api/collections/:id/notes/:cardId', async (req) => {
    const { id } = need(ctx, req, 'write');
    const card = cardId((req.params as { cardId: string }).cardId);
    const text = str((req.body as Record<string, unknown>)?.text, NOTE_MAX);
    if (text) ctx.db.run('INSERT OR REPLACE INTO notes (collection_id, card_id, text, updated_at) VALUES (?, ?, ?, ?)', id, card, text, now());
    else ctx.db.run('DELETE FROM notes WHERE collection_id = ? AND card_id = ?', id, card);
    return { cardId: card, text };
  });

  app.put('/api/collections/:id/graded/:gid', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { gid } = req.params as { gid: string };
    // The URL id wins over any id in the body, and must survive cleanGraded unchanged.
    const copy = cleanGraded({ ...(req.body as object), id: gid });
    if (!copy || copy.id !== gid) throw bad('That graded copy is invalid');
    putGraded(ctx, id, copy);
    void hydrateMissing(ctx, [copy.cardId]);
    return copy;
  });

  /** Soft delete so "Undo" can restore the slab and its photos. Purged by the cleanup job. */
  app.delete('/api/collections/:id/graded/:gid', async (req) => {
    const { id } = need(ctx, req, 'write');
    ctx.db.run('UPDATE graded SET deleted_at = ? WHERE collection_id = ? AND id = ?', now(), id, (req.params as { gid: string }).gid);
    return { ok: true };
  });

  app.get('/api/collections/:id/graded/:gid/photos', async (req) => {
    const { id } = need(ctx, req, 'read');
    return photosFor(ctx, id, (req.params as { gid: string }).gid);
  });

  // Multipart upload. Each part is sniffed and stored individually; size limits come from the
  // multipart plugin configuration in app.ts.
  app.post('/api/collections/:id/graded/:gid/photos', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { gid } = req.params as { gid: string };
    if (!ctx.db.get('SELECT 1 FROM graded WHERE collection_id = ? AND id = ?', id, gid)) throw notFound('Save the graded copy first');
    const out = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      const side = (part.fields.side as { value?: string } | undefined)?.value ?? 'other';
      out.push(savePhoto(ctx, id, gid, side, buf));
    }
    return out;
  });

  app.get('/api/collections/:id/photos/:pid', async (req, reply) => {
    const { id } = need(ctx, req, 'read');
    const { mime, stream } = streamPhoto(ctx, id, (req.params as { pid: string }).pid);
    // Photo ids are random and never reused, so the bytes behind a URL never change. `private`
    // keeps shared caches from storing them.
    reply.header('cache-control', 'private, max-age=31536000, immutable').type(mime);
    return reply.send(stream);
  });

  app.delete('/api/collections/:id/photos/:pid', async (req) => {
    const { id } = need(ctx, req, 'write');
    const { pid } = req.params as { pid: string };
    const res = ctx.db.run('DELETE FROM graded_photos WHERE id = ? AND collection_id = ?', pid, id);
    if (res.changes) deletePhotoFiles(ctx, [pid]);
    return { ok: true };
  });

  // Lets the client take a value snapshot on demand (e.g. after a big edit) instead of waiting for the nightly job.
  app.post('/api/collections/:id/value', async (req) => {
    const { id } = need(ctx, req, 'write');
    return { point: recordValue(ctx, id) ?? null };
  });

  // Backups can carry slab photos as data URLs.
  // Hence the much larger body limit than the global default, on this route only.
  app.post('/api/collections/:id/import', { bodyLimit: 200 * 1024 * 1024 }, async (req) => {
    const { id } = need(ctx, req, 'write');
    const result = await importInto(ctx, id, req.body);
    audit(ctx, req, 'collection.imported', id, result);
    return result;
  });

  /**
   * Full, unredacted backup. Any member, including viewers, may export: they can already see
   * every field in the app, so this exposes nothing new. Photos are not included.
   */
  app.get('/api/collections/:id/export', async (req, reply) => {
    const { id } = need(ctx, req, 'read');
    const s = collectionState(ctx, id);
    reply.header('content-disposition', `attachment; filename="poketracker-${new Date().toISOString().slice(0, 10)}.json"`);
    return {
      app: 'poketracker',
      version: 4,
      exportedAt: now(),
      collection: s.entries,
      wishlist: s.wishlist,
      graded: s.graded,
      notes: s.notes,
      history: s.history,
      lists: s.lists,
    };
  });

  // Wipes the contents but keeps the collection, its members and its shares. Owner only because
  // it is destructive and, unlike slab deletion, has no undo.
  app.post('/api/collections/:id/clear', async (req) => {
    const { id } = need(ctx, req, 'own');
    const photos = ctx.db.all<{ id: string }>('SELECT id FROM graded_photos WHERE collection_id = ?', id).map((p) => p.id);
    ctx.db.tx(() => {
      // Table names are a fixed list, never user input, so interpolating them is safe.
      for (const t of ['entries', 'wishlist', 'notes', 'graded', 'graded_photos', 'value_history', 'lists']) ctx.db.run(`DELETE FROM ${t} WHERE collection_id = ?`, id);
    });
    deletePhotoFiles(ctx, photos);
    audit(ctx, req, 'collection.cleared', id);
    return { ok: true };
  });

  // ------------------------------------------------------------ custom lists

  // Checks collection access, then that the list really belongs to that collection, so a list id
  // from somewhere else can't be edited through a collection the caller happens to have access to.
  const ownList = (req: FastifyRequest, level: 'read' | 'write') => {
    const { id, listId } = req.params as { id: string; listId: string };
    need(ctx, req, level);
    if (!ctx.db.get('SELECT 1 FROM lists WHERE id = ? AND collection_id = ?', listId, id)) throw notFound('List not found');
    return listId;
  };

  app.post('/api/collections/:id/lists', async (req) => {
    const { id } = need(ctx, req, 'write');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = str(body.name, 80);
    if (!name) throw bad('Give the list a name');
    if (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM lists WHERE collection_id = ?', id)!.n >= 200) throw bad('Too many lists');
    const listId = newId();
    const t = now();
    ctx.db.run('INSERT INTO lists (id, collection_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', listId, id, name, str(body.description, 500) || null, t, t);
    return { id: listId, name, description: str(body.description, 500) || undefined, createdAt: t, updatedAt: t, cards: [] };
  });

  app.patch('/api/collections/:id/lists/:listId', async (req) => {
    const listId = ownList(req, 'write');
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.name !== undefined) {
      const name = str(body.name, 80);
      if (!name) throw bad('Give the list a name');
      ctx.db.run('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?', name, now(), listId);
    }
    if (body.description !== undefined) ctx.db.run('UPDATE lists SET description = ?, updated_at = ? WHERE id = ?', str(body.description, 500) || null, now(), listId);
    if (Array.isArray(body.order)) {
      // Position is the array index; ids not already in the list are ignored by the WHERE clause.
      ctx.db.tx(() => (body.order as unknown[]).forEach((c, i) => typeof c === 'string' && ctx.db.run('UPDATE list_cards SET position = ? WHERE list_id = ? AND card_id = ?', i, listId, c)));
    }
    return { ok: true };
  });

  app.delete('/api/collections/:id/lists/:listId', async (req) => {
    const listId = ownList(req, 'write');
    ctx.db.run('DELETE FROM lists WHERE id = ?', listId);
    return { ok: true };
  });

  app.put('/api/collections/:id/lists/:listId/cards/:cardId', async (req) => {
    const listId = ownList(req, 'write');
    const card = cardId((req.params as { cardId: string }).cardId);
    if (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM list_cards WHERE list_id = ?', listId)!.n >= 2000) throw bad('That list is full');
    const pos = ctx.db.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM list_cards WHERE list_id = ?', listId)!.p;
    ctx.db.run('INSERT OR IGNORE INTO list_cards (list_id, card_id, position, added_at) VALUES (?, ?, ?, ?)', listId, card, pos, now());
    ctx.db.run('UPDATE lists SET updated_at = ? WHERE id = ?', now(), listId);
    void hydrateMissing(ctx, [card]);
    return { ok: true };
  });

  app.delete('/api/collections/:id/lists/:listId/cards/:cardId', async (req) => {
    const listId = ownList(req, 'write');
    ctx.db.run('DELETE FROM list_cards WHERE list_id = ? AND card_id = ?', listId, (req.params as { cardId: string }).cardId);
    return { ok: true };
  });

  // ------------------------------------------------------------ shared catalogue data
  // Card and set data is instance-wide, not per collection, so any signed-in user may fill it in.

  app.post('/api/cards/hydrate', async (req) => {
    requireUser(req);
    const ids = (req.body as { ids?: unknown[] })?.ids;
    if (!Array.isArray(ids) || ids.length > 100) throw bad('Send up to 100 ids');
    const clean = ids.filter((i): i is string => typeof i === 'string' && CARD_ID.test(i));
    await hydrateMissing(ctx, clean);
    return Array.from(readCards(ctx.db, clean).values());
  });

  /**
   * Records a set's master-set size as counted by the client from the catalogue, so completion
   * percentages work for every user without each one re-counting. The bounds keep obviously
   * bogus totals out.
   */
  app.put('/api/set-stats/:setId', async (req) => {
    requireUser(req);
    const setId = str((req.params as { setId: string }).setId, 100);
    const total = Math.floor(Number((req.body as Record<string, unknown>)?.masterTotal));
    if (!setId || !Number.isFinite(total) || total < 1 || total > 5000) throw bad('Invalid set total');
    ctx.db.run('INSERT OR REPLACE INTO set_stats (set_id, master_total, synced_at) VALUES (?, ?, ?)', setId, total, now());
    return { ok: true };
  });
}
