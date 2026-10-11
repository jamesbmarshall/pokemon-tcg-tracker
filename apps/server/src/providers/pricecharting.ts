/**
 * Optional PriceCharting integration: sealed product and graded-card pricing for people who pay
 * for a PriceCharting API key. Entirely opt-in — with no key configured this module makes no
 * network requests at all, and nothing in the UI that depends on it is shown.
 *
 * API shape (https://www.pricecharting.com/api-documentation): the real documentation sits
 * behind a paid "Legendary" subscription and returned 403 when this module was written, so the
 * request/response shape below is reconstructed from PriceCharting's publicly documented
 * authentication scheme (a 40-character token passed as the `t` query parameter) and from
 * third-party references to the same API (e.g. github.com/deansasek/pricecharting-api,
 * dlthub.com/context/source/pricecharting). Treat the field names as best-effort; `Test
 * connection` in Admin → Integrations is the way to confirm they work against a real key, and
 * every price lookup tolerates missing fields rather than throwing.
 *
 * Endpoints used:
 *   GET /api/products?t=<key>&q=<query>   -> { products: [{ id, "product-name", "console-name", ... }] }
 *   GET /api/product?t=<key>&id=<id>      -> a single product, same shape, with pricing fields
 * All prices are in US cents ("pennies"); divide by 100 for dollars.
 *
 * Pricing fields on a product (names per the references above):
 *   loose-price        ungraded / raw card, or a sealed product's single price
 *   cib-price / new-price  sealed-product condition tiers PriceCharting also exposes
 *   graded-price        a generic "graded" price with no specific grade — used as a fallback
 *   manual-only-price   manual-only (no box) price — last-resort fallback
 *   grade-<N>-price      PSA numeric grade, e.g. grade-9-price, grade-10-price (PSA is
 *                        PriceCharting's reference grading company)
 *   bgs-10-price         BGS Black Label / Gem Mint 10
 *   condition-17-price   CGC 9.5 (PriceCharting's "condition" numbering for third-party graders)
 *   condition-18-price   CGC 10
 * gradeFieldCandidates() below encodes this as an ordered list of field names to try.
 */
import type { FastifyInstance } from 'fastify';
import { HttpError, Limiter, audit, bad, requireRole, requireUser, type Ctx } from '../context.ts';
import { cachedUpstream } from '../catalog.ts';
import { redactSecrets } from '../security.ts';

const SETTINGS_KEY = 'pricecharting_key';
const BASE = 'https://www.pricecharting.com';
const SEARCH_TTL = 10 * 60_000;
const PRODUCT_TTL = 6 * 3600_000;

export interface PcProduct {
  id: string;
  name: string;
  consoleName?: string;
  /** Raw cent-valued fields as returned by the API, kept for gradeFieldCandidates lookups. */
  raw: Record<string, number | string | undefined>;
}

/** Whether a PriceCharting key is configured. Never returns the key itself. */
export function pcConfigured(ctx: Ctx): boolean {
  return !!ctx.db.get('SELECT 1 FROM settings WHERE key = ?', SETTINGS_KEY);
}

function pcKey(ctx: Ctx): string | undefined {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', SETTINGS_KEY);
  if (!row) return undefined;
  try {
    return ctx.sealer.open(row.value);
  } catch {
    return undefined;
  }
}

export function setPcKey(ctx: Ctx, key: string) {
  ctx.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', SETTINGS_KEY, ctx.sealer.seal(key));
}

export function clearPcKey(ctx: Ctx) {
  ctx.db.run('DELETE FROM settings WHERE key = ?', SETTINGS_KEY);
}

// Courtesy limit so a buggy client loop or a shared household can't hammer PriceCharting; well
// under any plan's quota. Keyed globally (not per user) since there is one shared API key.
const upstream = new Limiter(60, 60_000);

function toProduct(raw: Record<string, unknown>): PcProduct {
  return {
    id: String(raw.id ?? ''),
    name: String(raw['product-name'] ?? raw.name ?? ''),
    consoleName: raw['console-name'] ? String(raw['console-name']) : undefined,
    raw: raw as Record<string, number | string | undefined>,
  };
}

async function pcGet(ctx: Ctx, path: string, params: Record<string, string>, ttl: number): Promise<Record<string, unknown>> {
  const key = pcKey(ctx);
  if (!key) throw bad('PriceCharting is not configured');
  upstream.check('pricecharting');
  const qs = new URLSearchParams({ ...params, t: key }).toString();
  // Cache key omits the token so rotating the key doesn't silently serve another account's cache.
  const cacheKey = `PC ${path}?${new URLSearchParams(params).toString()}`;
  const r = await cachedUpstream(ctx, 'pricecharting', cacheKey, `${BASE}${path}?${qs}`, {}, ttl);
  if (r.status !== 200) throw new HttpError(502, 'PriceCharting request failed', 'upstream');
  try {
    return JSON.parse(r.body.toString('utf8'));
  } catch {
    throw new HttpError(502, 'PriceCharting returned an unexpected response', 'upstream');
  }
}

/** Product search. Caps results and query length; returns [] rather than throwing when unconfigured. */
export async function pcSearch(ctx: Ctx, query: string): Promise<PcProduct[]> {
  if (!pcConfigured(ctx)) return [];
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const body = await pcGet(ctx, '/api/products', { q }, SEARCH_TTL);
  const list = Array.isArray(body.products) ? body.products : [];
  return list.slice(0, 25).map((p) => toProduct(p as Record<string, unknown>));
}

/** A single product by PriceCharting id, with its full set of pricing fields. */
export async function pcProduct(ctx: Ctx, id: string): Promise<PcProduct> {
  const body = await pcGet(ctx, '/api/product', { id }, PRODUCT_TTL);
  return toProduct(body);
}

const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v / 100 : undefined);

/** Sealed product price: PriceCharting's "loose" price is the single price sealed listings use. */
export function pcSealedPrice(p: PcProduct): number | undefined {
  return cents(p.raw['loose-price']) ?? cents(p.raw['new-price']) ?? cents(p.raw['cib-price']);
}

/**
 * Ordered field-name candidates for a grading company + grade, most specific first. See the
 * module comment for where these names come from and why they are a best-effort mapping.
 */
function gradeFieldCandidates(company: string, grade: string): string[] {
  const slug = grade.trim().toLowerCase().replace(/\s+/g, '');
  const out: string[] = [];
  if (company === 'PSA') out.push(`grade-${slug}-price`, `psa-${slug}-price`);
  else if (company === 'BGS') out.push(slug === '10' ? 'bgs-10-price' : `bgs-${slug}-price`, `grade-${slug}-price`);
  else if (company === 'CGC') out.push(slug === '10' ? 'condition-18-price' : slug === '9.5' ? 'condition-17-price' : `cgc-${slug}-price`);
  else if (company === 'SGC') out.push(slug === '10' ? 'condition-18-price' : slug === '9.5' ? 'condition-17-price' : `sgc-${slug}-price`);
  else out.push(`${company.toLowerCase()}-${slug}-price`);
  out.push('graded-price', 'manual-only-price', 'loose-price');
  return out;
}

/** Graded price for a company + grade, trying each candidate field until one is present. */
export function pcGradedPrice(p: PcProduct, company: string, grade: string): number | undefined {
  for (const field of gradeFieldCandidates(company, grade)) {
    const v = cents(p.raw[field]);
    if (v != null) return v;
  }
  return undefined;
}

/**
 * Best-effort single-card fallback price when TCGdex has no TCGplayer/Cardmarket price at all
 * for a card. Zero requests when no key is configured. There is no per-card PriceCharting id
 * mapping (unlike graded slabs and sealed product, which the owner links by hand), so this
 * searches by name + set and takes the top result — the same best-effort approach the module
 * comment at the top of this file documents for the API shape itself. Returns undefined on any
 * failure or when nothing plausible comes back, so a fallback that doesn't pan out never breaks
 * the price refresh.
 */
export async function pcCardFallback(ctx: Ctx, card: { name: string; set: { name: string } }): Promise<number | undefined> {
  if (!pcConfigured(ctx)) return undefined;
  const results = await pcSearch(ctx, `${card.name} ${card.set.name}`);
  if (!results.length) return undefined;
  return pcSealedPrice(results[0]);
}

/** Refreshes pc_price for every graded slab linked to a PriceCharting product. Used by the 'prices' job. */
export async function refreshGradedPrices(ctx: Ctx): Promise<number> {
  if (!pcConfigured(ctx)) return 0;
  const rows = ctx.db.all<{ collection_id: string; id: string; data: string }>(
    "SELECT collection_id, id, data FROM graded WHERE deleted_at IS NULL AND json_extract(data, '$.pcProductId') IS NOT NULL",
  );
  let refreshed = 0;
  for (const r of rows) {
    try {
      const copy = JSON.parse(r.data) as { pcProductId?: string; company: string; grade: string };
      if (!copy.pcProductId) continue;
      const product = await pcProduct(ctx, copy.pcProductId);
      const price = pcGradedPrice(product, copy.company, copy.grade);
      if (price != null) {
        const updated = { ...JSON.parse(r.data), pcPrice: price, pcUpdatedAt: new Date().toISOString() };
        ctx.db.run('UPDATE graded SET data = ? WHERE collection_id = ? AND id = ?', JSON.stringify(updated), r.collection_id, r.id);
        refreshed++;
      }
    } catch (err) {
      ctx.log.warn({ err: redactSecrets((err as Error).message ?? String(err)), id: r.id }, 'graded price refresh failed');
    }
  }
  return refreshed;
}

export function pricechartingRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Any signed-in user may see whether PriceCharting is configured, to decide whether to show its UI. */
  app.get('/api/integrations', async (req) => {
    requireUser(req);
    return { pricecharting: { configured: pcConfigured(ctx) } };
  });

  app.get('/api/pricecharting/search', async (req) => {
    requireUser(req);
    const q = (req.query as { q?: string }).q ?? '';
    return { results: await pcSearch(ctx, q) };
  });

  app.get('/api/admin/integrations', async (req) => {
    requireRole(req, 'owner', 'admin');
    return { pricecharting: { configured: pcConfigured(ctx) } };
  });

  app.put('/api/admin/integrations/pricecharting', async (req) => {
    requireRole(req, 'owner', 'admin');
    const key = (req.body as { key?: unknown })?.key;
    if (typeof key !== 'string' || key.trim().length < 10 || key.trim().length > 100) throw bad('Enter a valid PriceCharting API key');
    setPcKey(ctx, key.trim());
    audit(ctx, req, 'integration.pricecharting_set');
    return { configured: true };
  });

  app.delete('/api/admin/integrations/pricecharting', async (req) => {
    requireRole(req, 'owner', 'admin');
    clearPcKey(ctx);
    audit(ctx, req, 'integration.pricecharting_cleared');
    return { configured: false };
  });

  app.post('/api/admin/integrations/pricecharting/test', async (req) => {
    requireRole(req, 'owner', 'admin');
    if (!pcConfigured(ctx)) throw bad('Set an API key first');
    try {
      await pcGet(ctx, '/api/products', { q: 'charizard' }, 0);
    } catch (err) {
      audit(ctx, req, 'integration.pricecharting_tested', undefined, { ok: false });
      // Redacted: a fetch failure can echo the request URL (and therefore the key) in its
      // message, and this text goes straight back to the admin's browser.
      throw new HttpError(502, `Couldn't reach PriceCharting: ${redactSecrets((err as Error).message)}`, 'upstream');
    }
    audit(ctx, req, 'integration.pricecharting_tested', undefined, { ok: true });
    return { ok: true };
  });
}
