/**
 * Read-only public demo. When DEMO_MODE is on, the server seeds a sample collection under a
 * single demo account, rejects every mutating request except demo sign-in/out, keeps the demo
 * account out of /api/setup's reach, and resets the seed every night (see jobs.ts).
 *
 * Nothing here runs unless config.demoMode is true, so a normal instance pays no cost for it.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { entryKey, GRADING_COMPANIES } from '@poketracker/shared/value';
import type { CollectionEntry, GradedCopy, WishlistEntry } from '@poketracker/shared/types';
import { audit, HttpError, now, type Ctx } from './context.ts';
import { createSession, createUser, toSessionUser } from './auth.ts';
import { putEntry, putGraded } from './collections.ts';
import { newId, randomToken } from './security.ts';
import { allSeedCardIds, buildSeedPlan } from './demo/seed.ts';
import { refreshCards } from './cards.ts';

export const DEMO_USERNAME = 'demo';
const DEMO_DISPLAY_NAME = 'Demo collector';

/**
 * Methods a visitor may call while signed in to the demo, beyond the universal GET/HEAD/OPTIONS.
 * Besides demo sign-in/out, these are POST/PUT routes that only populate the shared card
 * catalogue cache (names, images, set-completion counts) rather than anyone's own collection
 * data, so blocking them would just leave the demo looking broken rather than making it safer.
 */
export const DEMO_ALLOWED_MUTATIONS = new Set([
  'POST /api/demo/login',
  'POST /api/auth/logout',
  'POST /api/tcgdex/v2/graphql',
  'POST /api/cards/hydrate',
  'PUT /api/set-stats/:setId',
]);

/**
 * Global preHandler guard. Registered unconditionally (it is a no-op outside demo mode) so the
 * behaviour is exercised by the same code path in every environment. Runs after Fastify's
 * routing, so `routeOptions.url` is the registered path pattern (e.g. `/api/collections/:id`),
 * not the raw request URL with its real ids.
 */
export function demoGuard(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    if (!ctx.config.demoMode) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const pattern = req.routeOptions?.url ?? req.url;
    if (DEMO_ALLOWED_MUTATIONS.has(`${req.method} ${pattern}`)) return;
    throw new HttpError(403, "This is a read-only demo, so that change wasn't made. Deploy your own instance to use PokéTracker for real.", 'demo_read_only');
  };
}

/** Finds the demo user, if the seed has run. */
function demoUser(ctx: Ctx) {
  return ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', DEMO_USERNAME);
}

/**
 * Creates the demo account and its collection on first boot. Idempotent: if the account already
 * exists this does nothing, so it is safe to call on every startup. Because the demo account
 * counts towards the user total, it also blocks /api/setup from ever creating a real owner on a
 * demo instance.
 */
export async function seedDemo(ctx: Ctx): Promise<void> {
  if (!ctx.config.demoMode) return;
  if (demoUser(ctx)) return;
  await resetDemo(ctx);
}

/**
 * Wipes and rebuilds the demo collection from the seed plan. Used for the first seed and by the
 * nightly reset job, so visitors never permanently change (or break) the shared demo. Card
 * catalogue data is fetched from TCGdex like any other card; a failed fetch (e.g. no network
 * during tests) leaves entries pointing at ids the client simply can't hydrate yet.
 */
export async function resetDemo(ctx: Ctx): Promise<void> {
  let userId = demoUser(ctx)?.id;
  const plan = buildSeedPlan();

  ctx.db.tx(() => {
    if (userId) {
      // Wipe the account's own collection(s) rather than the account itself, so sessions survive a reset.
      for (const c of ctx.db.all<{ id: string }>('SELECT id FROM collections WHERE owner_id = ?', userId)) {
        ctx.db.run('DELETE FROM collections WHERE id = ?', c.id); // cascades to entries/wishlist/graded/lists/history
      }
      ctx.db.run("INSERT INTO collections (id, name, kind, owner_id, created_at) VALUES (?, 'My collection', 'personal', ?, ?)", newId(), userId, now());
    } else {
      // The demo password is random and never revealed; signing in only ever happens via /api/demo/login.
      userId = createUser(ctx, { username: DEMO_USERNAME, displayName: DEMO_DISPLAY_NAME, passwordHash: randomToken(32), role: 'member' });
    }
    const collectionId = ctx.db.get<{ id: string }>('SELECT id FROM collections WHERE owner_id = ?', userId!)!.id;

    const added = now();
    for (const cardId of plan.ownedIds) {
      const entry: CollectionEntry = { id: entryKey(cardId, 'normal'), cardId, setId: cardId.split('-')[0], variant: 'normal', quantity: 1, addedAt: added };
      putEntry(ctx, collectionId, entry);
    }
    for (const cardId of plan.wishlistIds) {
      const w: WishlistEntry = { cardId, addedAt: added };
      ctx.db.run('INSERT OR REPLACE INTO wishlist (collection_id, card_id, added_at) VALUES (?, ?, ?)', collectionId, w.cardId, w.addedAt);
    }
    for (const g of plan.graded) {
      if (!GRADING_COMPANIES.has(g.company)) continue; // belt and braces: keep the CHECK constraint happy
      const copy: GradedCopy = {
        id: newId(),
        cardId: g.cardId,
        setId: g.cardId.split('-')[0],
        variant: 'holofoil',
        company: g.company as GradedCopy['company'],
        grade: g.grade,
        label: g.label,
        certNumber: g.certNumber,
        countsTowardSet: true,
        addedAt: added,
      };
      putGraded(ctx, collectionId, copy);
    }
    for (const list of plan.lists) {
      const listId = newId();
      ctx.db.run('INSERT INTO lists (id, collection_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', listId, collectionId, list.name, list.description, added, added);
      list.cardIds.forEach((cardId, i) => ctx.db.run('INSERT INTO list_cards (list_id, card_id, position, added_at) VALUES (?, ?, ?, ?)', listId, cardId, i, added));
    }

    // A gently rising 60-day value history so the dashboard chart has something to show. Market
    // value is a rough per-card estimate (not real prices, which load separately from TCGdex);
    // the point is a believable shape, not accuracy.
    const perCard = 4.5;
    const days = 60;
    for (let i = days; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const grown = plan.ownedIds.length * perCard * (1 - i / (days * 3));
      const wobble = Math.sin(i / 4) * grown * 0.03;
      const valueUsd = Math.round((grown + wobble) * 100) / 100;
      ctx.db.run('INSERT OR REPLACE INTO value_history (collection_id, date, data) VALUES (?, ?, ?)', collectionId, date, JSON.stringify({ date, valueUsd, cards: plan.ownedIds.length, unique: plan.ownedIds.length }));
    }
  });

  // Best-effort: a demo instance without network access still boots, just with un-hydrated cards.
  await refreshCards(ctx, allSeedCardIds()).catch((err) => ctx.log?.warn?.({ err }, 'demo seed: could not fetch card data'));
}

/**
 * Public sign-in for visitors: no password, just a session for the shared demo account. Disabled
 * outside demo mode (the account won't exist) and exempt from demoGuard above so it is the one
 * way in.
 */
export function demoRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/api/demo/login', async (req, reply) => {
    if (!ctx.config.demoMode) throw new HttpError(404, 'Not found', 'not_found');
    const row = demoUser(ctx);
    if (!row) throw new HttpError(503, 'The demo is still starting up. Try again in a moment.', 'demo_not_ready');
    const full = ctx.db.get<Parameters<typeof toSessionUser>[0]>('SELECT * FROM users WHERE id = ?', row.id)!;
    createSession(ctx, req, reply, row.id);
    req.user = toSessionUser(full);
    audit(ctx, req, 'demo.login', row.id);
    return { user: req.user };
  });
}
