import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Heart, LayoutList, Minus, Plus, Upload, X } from 'lucide-react';
import { checkDeckLegality } from '@poketracker/shared/decks/legality';
import { computeDeckOwnership } from '@poketracker/shared/decks/ownership';
import { formatDeckText } from '@poketracker/shared/decks/ptcgl';
import type { CardSnapshot } from '../api/types';
import { getBackend, type CustomList, type DeckFormat, type DeckResolveResult } from '../api/backend';
import { useCollectionStore, useReadOnly } from '../store/collectionStore';
import { toast } from '../store/toastStore';
import CardImage from './CardImage';
import { FormError, Modal, StatusPill } from './forms';
import { useSubmit } from './formUtils';
import { EmptyState, Segmented } from './ui';

const SECTIONS: { key: CardSnapshot['supertype']; label: string }[] = [
  { key: 'Pokémon', label: 'Pokémon' },
  { key: 'Trainer', label: 'Trainer' },
  { key: 'Energy', label: 'Energy' },
];

const FORMAT_OPTIONS: { value: DeckFormat; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'expanded', label: 'Expanded' },
  { value: 'unlimited', label: 'Unlimited' },
];

type DeckCard = { card: CardSnapshot; qty: number };

function DeckCardRow({ listId, card, qty, readOnly }: { listId: string; card: CardSnapshot; qty: number; readOnly: boolean }) {
  const setDeckCardQty = useCollectionStore((s) => s.setDeckCardQty);
  return (
    <li className="flex items-center gap-3 py-1.5">
      <div className="h-12 w-[2.15rem] shrink-0 overflow-hidden rounded-[4.5%/3.2%] ring-1 ring-line">
        <CardImage id={card.id} src={card.image} name={card.name} number={card.number} setName={card.setName} />
      </div>
      <span className="min-w-0 flex-1 truncate text-sm">{card.name}</span>
      {readOnly ? (
        <span className="font-mono text-sm tabular">×{qty}</span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void setDeckCardQty(listId, card, qty - 1)}
            className="btn btn-ghost !h-7 !w-7 !p-0"
            aria-label={`Decrease ${card.name}`}
          >
            <Minus size={12} />
          </button>
          <span className="w-6 text-center font-mono text-sm tabular">{qty}</span>
          <button
            type="button"
            onClick={() => void setDeckCardQty(listId, card, Math.min(60, qty + 1))}
            disabled={qty >= 60}
            className="btn btn-ghost !h-7 !w-7 !p-0"
            aria-label={`Increase ${card.name}`}
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={() => void setDeckCardQty(listId, card, 0)}
            className="btn btn-ghost !h-7 !w-7 !p-0 hover:!text-loss"
            aria-label={`Remove ${card.name} from deck`}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </li>
  );
}

function ImportDeckDialog({ list, onClose }: { list: CustomList; onClose: () => void }) {
  const setDeckCardQty = useCollectionStore((s) => s.setDeckCardQty);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<DeckResolveResult | null>(null);

  const previewAction = useSubmit(async () => {
    if (!text.trim()) throw new Error('Paste a decklist first');
    const result = await getBackend().resolveDeckText(text);
    setPreview(result);
  });

  const confirmAction = useSubmit(async () => {
    if (!preview || !preview.resolved.length) throw new Error("Nothing resolved to add — check the pasted text");
    const totals = new Map<string, number>();
    const resolvedCardById = new Map<string, CardSnapshot>();
    for (const r of preview.resolved) {
      totals.set(r.card.id, (totals.get(r.card.id) ?? 0) + r.qty);
      resolvedCardById.set(r.card.id, r.card);
    }
    let added = 0;
    for (const [cardId, qty] of totals) {
      const card = resolvedCardById.get(cardId)!;
      const newQty = Math.min(60, (list.cardQtys[cardId] ?? 0) + qty);
      await setDeckCardQty(list.id, card, newQty);
      added += qty;
    }
    const lines = preview.resolved.length;
    toast(
      `Added ${added} card${added === 1 ? '' : 's'} from ${lines} line${lines === 1 ? '' : 's'}` +
        (preview.unresolved.length ? `; ${preview.unresolved.length} line${preview.unresolved.length === 1 ? '' : 's'} couldn't be matched` : ''),
    );
    onClose();
  });

  return (
    <Modal title="Import deck" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label htmlFor="deck-import-text" className="mb-1.5 block text-sm font-medium">
            Paste PTCGL or Limitless deck text
          </label>
          <textarea
            id="deck-import-text"
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            rows={10}
            placeholder={'4 Charizard ex OBF 125\n3 Arven SVI 166\n…'}
            className="input !h-auto py-2 font-mono text-xs"
          />
        </div>
        {!preview ? (
          <>
            <FormError error={previewAction.error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
              <button type="button" onClick={() => void previewAction.onSubmit()} disabled={previewAction.busy || !text.trim()} className="btn btn-primary">
                {previewAction.busy ? 'Checking…' : 'Preview'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {preview.resolved.length} card{preview.resolved.length === 1 ? '' : 's'} matched
              {preview.unresolved.length ? `; ${preview.unresolved.length} line${preview.unresolved.length === 1 ? '' : 's'} couldn't be matched` : ''}.
            </p>
            {preview.resolved.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-sm">
                {preview.resolved.map((r, i) => (
                  <li key={`${r.card.id}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="truncate">{r.card.name}</span>
                    <span className="font-mono text-xs text-faint">×{r.qty}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.unresolved.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-loss">{preview.unresolved.length} line{preview.unresolved.length === 1 ? '' : 's'} couldn't be matched:</p>
                <ul className="space-y-1 rounded-lg border border-loss/30 bg-loss/5 p-2 text-xs text-loss">
                  {preview.unresolved.map((l, i) => (
                    <li key={i} className="font-mono">
                      {l.raw}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <FormError error={confirmAction.error} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPreview(null)} className="btn btn-ghost">
                Back
              </button>
              <button type="button" onClick={() => void confirmAction.onSubmit()} disabled={confirmAction.busy || !preview.resolved.length} className="btn btn-primary">
                {confirmAction.busy ? 'Adding…' : 'Add to deck'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function DeckView({ list }: { list: CustomList }) {
  const cards = useCollectionStore((s) => s.cards);
  const byCard = useCollectionStore((s) => s.byCard);
  const wishlist = useCollectionStore((s) => s.wishlist);
  const updateList = useCollectionStore((s) => s.updateList);
  const toggleWishlist = useCollectionStore((s) => s.toggleWishlist);
  const readOnly = useReadOnly();
  const [importing, setImporting] = useState(false);

  const format = list.format ?? 'standard';
  const { data: settings } = useQuery({ queryKey: ['decks', 'settings'], queryFn: () => getBackend().getDeckSettings() });
  const legalityOpts = useMemo(
    () => ({ regulationMarks: settings?.regulationMarks, bannedCardIds: settings?.bannedCardIds }),
    [settings],
  );

  const deckCards = useMemo<DeckCard[]>(
    () =>
      list.cards
        .map((id) => ({ card: cards.get(id), qty: list.cardQtys[id] ?? 1 }))
        .filter((dc): dc is DeckCard => !!dc.card),
    [list.cards, list.cardQtys, cards],
  );

  const grouped = useMemo(() => {
    const g: Record<string, DeckCard[]> = { Pokémon: [], Trainer: [], Energy: [] };
    for (const dc of deckCards) (g[dc.card.supertype] ?? (g[dc.card.supertype] = [])).push(dc);
    return g;
  }, [deckCards]);

  const total = useMemo(() => {
    const fromQtys = Object.values(list.cardQtys).reduce((a, b) => a + b, 0);
    return fromQtys || list.cards.length;
  }, [list.cardQtys, list.cards.length]);

  const legality = useMemo(() => checkDeckLegality(deckCards, format, legalityOpts), [deckCards, format, legalityOpts]);

  const ownedQtyByCardId = useMemo(
    () => new Map(Array.from(byCard.entries()).map(([id, v]) => [id, Object.values(v).reduce((a, b) => a + b, 0)])),
    [byCard],
  );
  const ownership = useMemo(
    () => computeDeckOwnership(deckCards, format, ownedQtyByCardId, Array.from(cards.values()), legalityOpts),
    [deckCards, format, ownedQtyByCardId, cards, legalityOpts],
  );
  const missing = ownership.filter((o) => o.missing > 0);

  const addMissingToWishlist = async () => {
    let added = 0;
    for (const o of missing) {
      for (const id of o.deckCardIds) {
        if (wishlist.has(id)) continue;
        const card = cards.get(id);
        if (!card) continue;
        await toggleWishlist(card);
        added++;
      }
    }
    toast(added ? `Added ${added} card${added === 1 ? '' : 's'} to your wishlist` : 'Nothing to add — every missing card is already wishlisted');
  };

  const copyAsText = async () => {
    try {
      await navigator.clipboard.writeText(formatDeckText(deckCards));
      toast('Copied deck list', { tone: 'success' });
    } catch {
      toast('Could not copy to clipboard', { tone: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted tabular">{total}/60 cards</p>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <button type="button" onClick={() => setImporting(true)} className="btn btn-ghost !h-9 !text-xs">
              <Upload size={14} /> Import deck
            </button>
          )}
          <button type="button" onClick={() => void copyAsText()} className="btn btn-ghost !h-9 !text-xs">
            <Copy size={14} /> Copy as text
          </button>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow">Format &amp; legality</p>
          {readOnly ? (
            <StatusPill tone="muted">{FORMAT_OPTIONS.find((o) => o.value === format)?.label}</StatusPill>
          ) : (
            <Segmented value={format} onChange={(f) => void updateList(list.id, { format: f })} options={FORMAT_OPTIONS} size="sm" />
          )}
        </div>
        <div aria-live="polite">
          {legality.legal ? (
            <StatusPill tone="good">Legal in {FORMAT_OPTIONS.find((o) => o.value === format)?.label}</StatusPill>
          ) : (
            <div className="space-y-2">
              <StatusPill tone="bad">
                {legality.issues.length} issue{legality.issues.length === 1 ? '' : 's'}
              </StatusPill>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                {legality.issues.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Owned vs needed</p>
          {!readOnly && (
            <button type="button" onClick={() => void addMissingToWishlist()} disabled={!missing.length} className="btn btn-ghost !h-8 !text-xs">
              <Heart size={13} /> Add missing to wishlist
            </button>
          )}
        </div>
        {ownership.length ? (
          <ul className="space-y-1 text-sm">
            {ownership.map((o) => (
              <li key={o.name} className={`flex items-center justify-between gap-2 ${o.missing > 0 ? 'text-loss' : ''}`}>
                <span className="truncate">{o.name}</span>
                <span className="font-mono text-xs tabular">
                  own {o.owned}, need {o.needed}
                  {o.missing > 0 ? ` (missing ${o.missing})` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Add cards to the deck to see what you own.</p>
        )}
      </div>

      {deckCards.length ? (
        <div className="space-y-6">
          {SECTIONS.map(
            ({ key, label }) =>
              grouped[key].length > 0 && (
                <div key={key}>
                  <h3 className="eyebrow mb-2">
                    {label} · {grouped[key].reduce((a, dc) => a + dc.qty, 0)}
                  </h3>
                  <ul className="divide-y divide-line">
                    {grouped[key].map((dc) => (
                      <DeckCardRow key={dc.card.id} listId={list.id} card={dc.card} qty={dc.qty} readOnly={readOnly} />
                    ))}
                  </ul>
                </div>
              ),
          )}
        </div>
      ) : (
        <EmptyState icon={<LayoutList size={22} />} title="This deck is empty">
          {readOnly ? 'No cards yet.' : 'Use Import deck to paste a decklist and get started.'}
        </EmptyState>
      )}

      {importing && <ImportDeckDialog list={list} onClose={() => setImporting(false)} />}
    </div>
  );
}
