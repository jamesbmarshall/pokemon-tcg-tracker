/**
 * Public share page (/s/:token). Loads the share payload, swaps the collection store onto a
 * read-only backend, and renders the shared slice with the normal card components.
 *
 * Everything the visitor receives has already been scoped and redacted by the server according
 * to the share's privacy flags. Hiding values or notes in this UI is therefore cosmetic: the data
 * was never sent. Opening the link also sets a short-lived share cookie, which is what lets an
 * anonymous visitor load card images and catalogue data through the server's proxy.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, Eye, Heart, Layers, ListChecks } from 'lucide-react';
import { ApiError } from '../api/http';
import { httpBackend, setBackend } from '../api/backend';
import { publicBackend } from '../api/publicBackend';
import { sharing, type PublicShare } from '../api/sharing';
import { compareCardNumber } from '../api/client';
import { useSetCards } from '../api/hooks';
import type { CardSnapshot } from '../api/types';
import { computeValue, useCollectionStore } from '../store/collectionStore';
import { useAuth } from '../store/authStore';
import { useMoney } from '../hooks/useMoney';
import { formatDate } from '../utils/format';
import { PublicShareContext } from '../components/shareContext';
import CardGrid from '../components/CardGrid';
import { Logo } from '../components/ui';
import { AuthShell, LoginPage } from './AuthPages';

const bySetThenNumber = (a: CardSnapshot, b: CardSnapshot) => a.setName.localeCompare(b.setName) || compareCardNumber(a, b);

function Section({ icon, title, count, children }: { icon: ReactNode; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
        {count !== undefined && <span className="font-mono text-sm text-faint">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * A shared set is shown as a checklist with missing cards dimmed. If the full card list can't be
 * loaded, fall back to just the owned cards that came with the share.
 */
function SetChecklist({ setId }: { setId: string }) {
  const { data, isError } = useSetCards(setId);
  const cards = useCollectionStore((s) => s.cards);
  const fallback = useMemo(() => [...cards.values()].filter((c) => c.setId === setId).sort(compareCardNumber), [cards, setId]);
  if (data && !isError) return <CardGrid cards={data} dimMissing />;
  return <CardGrid cards={fallback} />;
}

function ShareBody({ data }: { data: PublicShare }) {
  const cards = useCollectionStore((s) => s.cards);
  const byCard = useCollectionStore((s) => s.byCard);
  const gradedByCard = useCollectionStore((s) => s.gradedByCard);
  const pick = (ids: Iterable<string>) => [...new Set(ids)].map((id) => cards.get(id)).filter((c): c is CardSnapshot => !!c);
  const { scope, target } = data.share;

  // A card held only as a slab still counts as "in the collection".
  const owned = pick([...byCard.keys(), ...gradedByCard.keys()]).sort(bySetThenNumber);
  const wished = pick(data.wishlist.map((w) => w.cardId));
  const graded = pick(gradedByCard.keys()).sort(bySetThenNumber);

  switch (scope) {
    case 'set':
      return <SetChecklist setId={target ?? ''} />;
    case 'wishlist':
      return wished.length ? <CardGrid cards={wished} showSet /> : <Empty>The wishlist is empty.</Empty>;
    case 'graded':
      return graded.length ? <CardGrid cards={graded} showSet /> : <Empty>No graded cards yet.</Empty>;
    case 'list': {
      // A list share carries exactly one list: the shared one.
      const list = data.lists[0];
      if (!list) return <Empty>This list is empty.</Empty>;
      const items = pick(list.cards);
      return items.length ? <CardGrid cards={items} showSet /> : <Empty>This list is empty.</Empty>;
    }
    default:
      return (
        <div className="space-y-12">
          <Section icon={<Layers size={18} />} title="Cards" count={owned.length}>
            {owned.length ? <CardGrid cards={owned} showSet /> : <Empty>No cards yet.</Empty>}
          </Section>
          {wished.length > 0 && (
            <Section icon={<Heart size={18} />} title="Wishlist" count={wished.length}>
              <CardGrid cards={wished} showSet />
            </Section>
          )}
          {data.lists.map((l) => (
            <Section key={l.id} icon={<ListChecks size={18} />} title={l.name} count={l.cards.length}>
              {l.description && <p className="-mt-2 text-sm text-muted">{l.description}</p>}
              <CardGrid cards={pick(l.cards)} showSet />
            </Section>
          ))}
        </div>
      );
  }
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border-y border-line px-6 py-12 text-center text-sm text-muted">{children}</p>;
}

function heading(data: PublicShare) {
  const { share } = data;
  if (share.title) return share.title;
  const owner = `${share.ownerName}'s`;
  switch (share.scope) {
    case 'set':
      return `${owner} ${data.cards.find((c) => c.setId === share.target)?.setName ?? 'set'}`;
    case 'wishlist':
      return `${owner} wishlist`;
    case 'graded':
      return `${owner} graded cards`;
    case 'list':
      return data.lists[0]?.name ?? `${owner} list`;
    default:
      return `${owner} collection`;
  }
}

function SharedView({ data, token }: { data: PublicShare; token: string }) {
  const money = useMoney();
  const entries = useCollectionStore((s) => s.entries);
  const graded = useCollectionStore((s) => s.graded);
  const cards = useCollectionStore((s) => s.cards);
  const { valueUsd, count } = useMemo(() => computeValue(entries.values(), cards, graded.values()), [entries, cards, graded]);
  const title = heading(data);

  useEffect(() => {
    document.title = `${title} · PokéTracker`;
  }, [title]);

  // Wishlists and lists aren't owned cards, so a count or value total would be misleading.
  const showTotals = data.share.scope !== 'wishlist' && data.share.scope !== 'list';

  return (
    <PublicShareContext.Provider value={{ token }}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur-md sm:px-6">
          <a href="/" className="flex items-center gap-2">
            <Logo size={26} />
            <span className="font-display text-lg font-semibold tracking-tight">
              Poké<span className="holo-text">Tracker</span>
            </span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-muted">
            <Eye size={12} /> View only
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1400px] space-y-8 px-4 pb-16 pt-8 sm:px-6 lg:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow mb-2">Shared by {data.share.ownerName}</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              {data.share.scope === 'list' && data.lists[0]?.description && <p className="mt-2 text-sm text-muted">{data.lists[0].description}</p>}
              {data.share.expiresAt && <p className="mt-2 text-xs text-faint">This link works until {formatDate(data.share.expiresAt)}.</p>}
            </div>
            {showTotals && (
              <div className="text-right">
                <p className="eyebrow">{count.toLocaleString('en-GB')} cards</p>
                {/* With hideValue the server sends no prices, so this would only ever show zero. */}
                {!data.share.hideValue && <p className="font-display text-2xl font-semibold tabular">{money(valueUsd)}</p>}
              </div>
            )}
          </div>
          {data.share.scope === 'graded' && graded.size > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Award size={15} className="text-accent" /> {graded.size} slab{graded.size === 1 ? '' : 's'}
            </p>
          )}
          <ShareBody data={data} />
          <footer className="border-t border-line pt-6 text-xs text-faint">
            Card data, images & prices from TCGdex. Pokémon and card images © The Pokémon Company.
          </footer>
        </main>
      </div>
    </PublicShareContext.Provider>
  );
}

/**
 * /s/:token: a read-only view of whatever was shared. Works signed out for public links;
 * links for specific people or everyone on the server ask you to sign in first.
 */
export default function PublicSharePage() {
  const { token = '' } = useParams();
  const authStatus = useAuth((s) => s.status);
  const signedIn = authStatus === 'ready';
  const show = useCollectionStore((s) => s.show);
  const reset = useCollectionStore((s) => s.reset);
  const shownId = `share:${token}`;
  const shown = useCollectionStore((s) => s.collectionId === shownId);

  // signedIn is part of the key so signing in on this page refetches: a 'users' or 'instance' share
  // that returned 401 to the anonymous visitor may now open. No retries: errors here are final.
  const q = useQuery({ queryKey: ['public-share', token, signedIn], queryFn: () => sharing.open(token), retry: false, staleTime: Infinity });

  useEffect(() => {
    const data = q.data;
    if (!data) return;
    // Swap the backend before show() so anything the store triggers goes through the read-only one.
    setBackend(publicBackend(token));
    show({
      collectionId: shownId,
      entries: new Map(data.entries.map((e) => [e.id, e])),
      graded: new Map(data.graded.map((g) => [g.id, g])),
      wishlist: new Map(data.wishlist.map((w) => [w.cardId, w])),
      notes: new Map(data.notes.map((n) => [n.cardId, n.text])),
      cards: new Map(data.cards.map((c) => [c.id, c])),
      setStats: new Map(data.setStats.map((s) => [s.setId, s])),
      history: data.history,
      lists: data.lists,
    });
    // Leaving the page must not leave share data in the store, or the signed-in app could briefly
    // show someone else's cards as if they were the user's own.
    return () => {
      setBackend(httpBackend);
      reset();
    };
  }, [q.data, token, shownId, show, reset]);

  if (q.error) {
    const err = q.error;
    // 401 means the share needs a signed-in viewer. Expired, revoked, unknown and "not shared with
    // you" all get one message, so the page doesn't say which it was.
    if (err instanceof ApiError && err.status === 401 && authStatus !== 'ready' && authStatus !== 'loading') {
      return authStatus === 'signed-out' || authStatus === 'mfa' ? <LoginPage /> : <Unavailable message="Sign in to PokéTracker to see this." />;
    }
    if (err instanceof ApiError && err.status === 0) return <Unavailable message="Couldn't reach the server. Check your connection and try again." />;
    return <Unavailable message="This link has expired, been revoked, or isn't shared with you." />;
  }
  // Wait until the store actually holds this share, not just until the query resolves, so the
  // first render never shows leftover data from the user's own collection.
  if (!shown || !q.data) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading">
        <div className="animate-pulse">
          <Logo size={40} />
        </div>
      </div>
    );
  }
  return <SharedView data={q.data} token={token} />;
}

function Unavailable({ message }: { message: string }) {
  return (
    <AuthShell title="Can't open this link" intro={message}>
      <a href="/" className="btn btn-primary w-full">
        Go to PokéTracker
      </a>
    </AuthShell>
  );
}
