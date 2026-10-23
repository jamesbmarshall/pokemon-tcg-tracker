import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Layers, Trash2 } from 'lucide-react';
import { Modal, ConfirmDialog } from '../components/forms';
import { PageHeader, EmptyState, ProgressBar } from '../components/ui';
import CardImage from '../components/CardImage';
import type {
  DeckItem,
  DeckZone,
  TcgCard,
  TcgList,
} from '@poketracker/shared/tcg/types';
import type { DeckTextRow } from '@poketracker/shared/tcg/deckText';
import { cardValue } from '@poketracker/shared/tcg/collection';
import { api } from '../api/http';
import { useMoney } from '../hooks/useMoney';
import { currentRates } from '../utils/fx';
import { useGame } from './context';
import { download } from './api';
export function DecksPage({ listId }: { listId?: string }) {
  const { module, state, save, remove, busy, readOnly } = useGame();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState<'list' | 'deck' | null>(null);
  const [deleting, setDeleting] = useState<TcgList | null>(null);
  const list = state.lists.find((l) => l.id === listId);
  if (listId)
    return list ? (
      <DeckEditor key={list.id} list={list} />
    ) : (
      <p>List not found.</p>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={module.shortName}
        title="Lists & decks"
        actions={
          !readOnly && (
            <>
              {module.capabilities.precons && (
                <Link
                  className="btn btn-ghost"
                  to={`/${module.id}/search?tab=precons`}
                >
                  Browse precons
                </Link>
              )}
              <button
                className="btn btn-ghost"
                onClick={() => setCreating('list')}
              >
                <Plus size={15} />
                New list
              </button>
              {module.capabilities.decks && (
                <button
                  className="btn btn-primary"
                  onClick={() => setCreating('deck')}
                >
                  <Plus size={15} />
                  New {module.formats[0]?.name} deck
                </button>
              )}
            </>
          )
        }
      >
        Build a deck, track the cards you need, or curate a list.
      </PageHeader>
      {creating && (
        <Modal
          title={
            creating === 'deck'
              ? `New ${module.formats[0]?.name ?? ''} deck`
              : 'New list'
          }
          onClose={() => setCreating(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const id = crypto.randomUUID();
              void save([
                {
                  kind: 'list',
                  id,
                  data: {
                    id,
                    game: module.id,
                    name: name.trim(),
                    kind: creating,
                    format:
                      creating === 'deck' ? module.formats[0]?.id : undefined,
                    items: [],
                    addedAt: new Date().toISOString(),
                  },
                },
              ]).then((ok) => {
                if (ok) {
                  setName('');
                  setCreating(null);
                }
              });
            }}
          >
            <label className="block text-sm">
              List or deck name
              <input
                autoFocus
                required
                maxLength={200}
                className="input mt-2 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setCreating(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !name.trim()}
              >
                Create{' '}
                {creating === 'deck'
                  ? `${module.formats[0]?.name ?? ''} deck`
                  : 'list'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="This removes the list. Cards in your collection will be kept."
          action="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (!(await remove('list', deleting.id)))
              throw new Error('Could not delete list. Try again.');
          }}
        />
      )}
      {!state.lists.length && (
        <EmptyState
          icon={<Layers size={28} />}
          title="A home for your next idea"
        >
          Create a list or start building a deck.
        </EmptyState>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {state.lists.map((l) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-5 hover:border-line-strong"
            key={l.id}
          >
            <Link
              className="min-w-0 flex-1 font-display text-xl hover:text-accent"
              to={`/${module.id}/lists/${l.id}`}
            >
              {l.name}
              <span className="mt-2 block font-body text-xs text-muted">
                {l.kind === 'deck' ? l.format : 'List'} ·{' '}
                {l.items.reduce((n, i) => n + i.quantity, 0)} cards
              </span>
            </Link>
            {!readOnly && (
              <button
                className="btn btn-ghost"
                disabled={busy}
                aria-label={`Delete ${l.name}`}
                onClick={() => setDeleting(l)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function ImportDeck({ list, onDone }: { list: TcgList; onDone: () => void }) {
  const { module, save, busy } = useGame();
  const [text, setText] = useState(''),
    [resolving, setResolving] = useState(false),
    [error, setError] = useState(''),
    [rows, setRows] = useState<{ row: DeckTextRow; candidates: TcgCard[] }[]>(
      [],
    ),
    [choices, setChoices] = useState<Record<number, string>>({});
  const resolve = async () => {
    setResolving(true);
    setError('');
    try {
      const result = await api<{ resolved: typeof rows; errors: string[] }>(
        `/api/games/${module.id}/decks/resolve`,
        { method: 'POST', body: { text } },
      );
      setRows(result.resolved);
      setError(result.errors.join('\n'));
      setChoices(
        Object.fromEntries(
          result.resolved.map((r, n) => [
            n,
            r.candidates.length === 1 ? r.candidates[0].id : '',
          ]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  };
  const commit = async () => {
    const items: DeckItem[] = [];
    for (const [n, r] of rows.entries()) {
      const id = choices[n];
      if (!id) return;
      const zone = list.kind === 'list' ? 'main' : r.row.zone;
      const prev = items.find((i) => i.cardId === id && i.zone === zone);
      if (prev) prev.quantity += r.row.quantity;
      else
        items.push({
          cardId: id,
          quantity: list.kind === 'list' ? 1 : r.row.quantity,
          zone,
        });
    }
    if (await save([{ kind: 'list', id: list.id, data: { ...list, items } }]))
      onDone();
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">
        Paste quantity/name lines, optionally with (SET) collector number. Use
        Commander, Deck, Companion and Maybeboard headings. Import replaces this
        list after preview.
      </p>
      <label className="block">
        Decklist
        <textarea
          className="input mt-1 min-h-44 w-full font-mono text-sm"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows([]);
          }}
          maxLength={200000}
        />
      </label>
      <label className="block text-sm">
        Upload text file
        <input
          className="mt-2 block max-w-full text-xs"
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && file.size <= 200000)
              void file.text().then((t) => {
                setText(t);
                setRows([]);
              });
          }}
        />
      </label>
      <button
        className="btn btn-ghost"
        disabled={resolving || !text.trim()}
        onClick={() => void resolve()}
      >
        {resolving ? 'Resolving…' : 'Preview import'}
      </button>
      {error && (
        <p role="alert" className="whitespace-pre-wrap text-loss">
          {error}
        </p>
      )}
      {rows.map((r, n) => (
        <label className="block text-sm" key={n}>
          {r.row.quantity} {r.row.name} · {r.row.zone}
          <select
            className="input mt-1 w-full"
            value={choices[n] ?? ''}
            onChange={(e) => setChoices({ ...choices, [n]: e.target.value })}
          >
            <option value="">
              {r.candidates.length
                ? 'Choose printing'
                : 'Unresolved — correct the source text'}
            </option>
            {r.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.setName} · {c.number} · {c.language}
              </option>
            ))}
          </select>
        </label>
      ))}
      {rows.length > 0 && (
        <button
          className="btn btn-primary"
          disabled={busy || !!error || rows.some((_, n) => !choices[n])}
          onClick={() => void commit()}
        >
          Replace with previewed cards
        </button>
      )}
    </section>
  );
}
function DeckEditor({ list }: { list: TcgList }) {
  const { module, state, save, busy, readOnly } = useGame();
  const money = useMoney();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false),
    [addId, setAddId] = useState(''),
    [zone, setZone] = useState<DeckZone>('main'),
    [name, setName] = useState(list.name),
    [description, setDescription] = useState(list.description ?? '');
  const cards = new Map(state.cards.map((c) => [c.id, c]));
  const format = module.formats.find((f) => f.id === list.format);
  const legality =
    list.kind === 'deck' ? format?.validate(list.items, cards) : undefined;
  const ownership =
    module.deckTools?.ownership(list.items, cards, state.entries) ?? [];
  const analysis = module.deckTools?.analyze(list.items, cards) ?? {};
  const change = (items: DeckItem[]) =>
    save([{ kind: 'list', id: list.id, data: { ...list, items } }]);
  const total = list.items
    .filter((i) => i.zone === 'main' || i.zone === 'commander')
    .reduce((n, i) => n + i.quantity, 0);
  const value = list.items
    .filter((i) => i.zone !== 'maybeboard')
    .reduce(
      (n, i) =>
        n +
        (cardValue(
          cards.get(i.cardId),
          cards.get(i.cardId)?.finishes[0] ?? '',
          currentRates().EUR,
        ) ?? 0) *
          i.quantity,
      0,
    );
  return (
    <div className="space-y-6">
      <Link to={`/${module.id}/lists`} className="text-sm text-accent">
        ← Lists & decks
      </Link>
      <PageHeader
        eyebrow={list.kind === 'deck' ? (format?.name ?? 'Deck') : 'List'}
        title={list.name}
        actions={
          !readOnly && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setEditing(true)}
              >
                Edit details
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setAdding(true)}
              >
                <Plus size={15} />
                Add cards
              </button>
            </>
          )
        }
      >
        {list.kind === 'deck'
          ? `${total}/${format?.size ?? '?'} cards`
          : `${total} cards`}{' '}
        · {money(value)}
        {list.description && (
          <span className="mt-2 block">{list.description}</span>
        )}
      </PageHeader>
      {!readOnly && editing && (
        <Modal title="Edit details" onClose={() => setEditing(false)}>
          <form
            className="flex flex-wrap gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save([
                {
                  kind: 'list',
                  id: list.id,
                  data: { ...list, name, description },
                },
              ]).then((ok) => {
                if (ok) setEditing(false);
              });
            }}
          >
            <label>
              Name
              <input
                className="input block"
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Description
              <input
                className="input block"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button className="btn btn-ghost self-end" disabled={busy}>
              Save details
            </button>
          </form>
        </Modal>
      )}
      {legality && (
        <section
          className={`rounded-lg border p-4 ${legality.status === 'legal' ? 'border-gain/25 bg-gain/5' : 'border-line bg-surface'}`}
          aria-label="Deck legality"
        >
          <h2 className="font-semibold">
            {legality.status === 'legal'
              ? `Legal in ${format?.name ?? 'format'}`
              : legality.status === 'unverified'
                ? 'Legality needs verification'
                : `${format?.name ?? 'Deck'} rules issues`}
          </h2>
          {legality.issues.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">
                {legality.issues.length} issues to review
              </summary>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                {legality.issues.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-2 text-xs text-faint">
            Decks can be saved with warnings. Legality uses the latest cached
            rules data.
          </p>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-ghost"
          onClick={() =>
            download(
              `${list.name}.txt`,
              module.deckTools?.format(list.items, cards) ?? '',
              'text/plain',
            )
          }
        >
          Export text
        </button>
        {!readOnly && (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setImporting(!importing)}
            >
              Import text
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || !ownership.some((o) => o.missing)}
              onClick={() =>
                void save(
                  ownership
                    .filter((o) => o.missing)
                    .map((o) => ({
                      kind: 'wishlist',
                      id: o.cardId,
                      data: { id: o.cardId },
                    })),
                )
              }
            >
              Wishlist missing cards
            </button>
          </>
        )}
      </div>
      {importing && !readOnly && (
        <Modal title="Import decklist" wide onClose={() => setImporting(false)}>
          <ImportDeck list={list} onDone={() => setImporting(false)} />
        </Modal>
      )}
      {!readOnly && adding && (
        <Modal title="Add cards" onClose={() => setAdding(false)}>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const prev = list.items.find(
                (i) => i.cardId === addId && i.zone === zone,
              );
              void change(
                prev
                  ? list.items.map((i) =>
                      i === prev ? { ...i, quantity: i.quantity + 1 } : i,
                    )
                  : [...list.items, { cardId: addId, quantity: 1, zone }],
              );
            }}
          >
            <label>
              Add known card
              <select
                className="input block max-w-72"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              >
                <option value="">Choose a card</option>
                {state.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.setCode} {c.number})
                  </option>
                ))}
              </select>
            </label>
            {list.kind === 'deck' && (
              <label>
                Section
                <select
                  className="input block"
                  value={zone}
                  onChange={(e) => setZone(e.target.value as DeckZone)}
                >
                  {['main', 'commander', 'companion', 'maybeboard'].map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn btn-primary" disabled={busy || !addId}>
              Add
            </button>
            <Link to={`/${module.id}/search`} className="btn btn-ghost">
              Find cards
            </Link>
          </form>
        </Modal>
      )}
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          {(['commander', 'main', 'companion', 'maybeboard'] as const)
            .filter((z) => z === 'main' || list.items.some((i) => i.zone === z))
            .map((z) => (
              <section key={z} className="space-y-2">
                <h2 className="eyebrow border-b border-line pb-3 capitalize">
                  {z}{' '}
                  <span className="ml-2 text-faint">
                    {list.items
                      .filter((i) => i.zone === z)
                      .reduce((n, i) => n + i.quantity, 0)}
                  </span>
                </h2>
                {list.items
                  .filter((i) => i.zone === z)
                  .map((i) => {
                    const card = cards.get(i.cardId);
                    return (
                      <div
                        className="flex items-center gap-3 border-b border-line py-2.5"
                        key={i.cardId}
                      >
                        {card && (
                          <Link
                            className="h-14 w-10 shrink-0 overflow-hidden rounded"
                            tabIndex={-1}
                            aria-hidden="true"
                            to={`/${module.id}/card/${encodeURIComponent(i.cardId)}`}
                          >
                            <CardImage
                              id={card.id}
                              src={card.image ?? ''}
                              name={card.name}
                            />
                          </Link>
                        )}
                        <Link
                          className="min-w-0 flex-1 text-sm font-medium hover:text-accent"
                          to={`/${module.id}/card/${encodeURIComponent(i.cardId)}`}
                        >
                          {card?.name ?? i.cardId}
                          <span className="mt-1 block font-mono text-[10px] uppercase text-muted">
                            {card?.setCode} {card?.number}
                          </span>
                        </Link>
                        {!readOnly && (
                          <>
                            <label
                              className="sr-only"
                              htmlFor={`${z}-${i.cardId}`}
                            >
                              Quantity of {card?.name}
                            </label>
                            <input
                              className="input !w-16 !px-2 text-center"
                              key={i.quantity}
                              id={`${z}-${i.cardId}`}
                              type="number"
                              min="1"
                              max="1000"
                              disabled={busy}
                              defaultValue={i.quantity}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') {
                                  e.currentTarget.value = String(i.quantity);
                                  e.currentTarget.blur();
                                }
                              }}
                              onBlur={(e) => {
                                const input = e.currentTarget;
                                const n = Number(input.value);
                                if (
                                  Number.isInteger(n) &&
                                  n >= 1 &&
                                  n <= 1000 &&
                                  n !== i.quantity
                                )
                                  void change(
                                    list.items.map((x) =>
                                      x === i ? { ...x, quantity: n } : x,
                                    ),
                                  ).then((ok) => {
                                    if (!ok) input.value = String(i.quantity);
                                  });
                                else input.value = String(i.quantity);
                              }}
                            />
                            <button
                              className="btn btn-ghost !px-2"
                              aria-label={`Remove ${card?.name ?? i.cardId}`}
                              disabled={busy}
                              onClick={() =>
                                void change(list.items.filter((x) => x !== i))
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        {readOnly && <span>×{i.quantity}</span>}
                      </div>
                    );
                  })}
              </section>
            ))}
          {!list.items.length && (
            <EmptyState
              icon={<Layers size={28} />}
              title="Your deck is a blank canvas"
              action={
                !readOnly && (
                  <button
                    className="btn btn-primary"
                    onClick={() => setImporting(true)}
                  >
                    Import a decklist
                  </button>
                )
              }
            >
              Add cards or import a decklist to get started.
            </EmptyState>
          )}
        </div>
        {list.kind === 'deck' && (
          <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
            <section>
              <h2 className="mb-3 font-semibold">Owned vs needed</h2>
              <p className="mb-4 text-xs text-muted">
                {ownership.reduce((n, o) => n + Math.min(o.owned, o.needed), 0)}{' '}
                of {ownership.reduce((n, o) => n + o.needed, 0)} required copies
                owned
              </p>
              <div className="space-y-3">
                {ownership.map((o) => (
                  <div
                    className="flex items-start justify-between gap-3 border-b border-line pb-3 text-xs"
                    key={o.cardId}
                  >
                    <span className="min-w-0">
                      {o.name}
                      <span className="mt-1 block font-mono text-[10px] text-muted">
                        {o.owned} owned · {o.needed} needed
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded px-2 py-1 font-mono text-[10px] ${o.missing ? 'bg-wish/10 text-wish' : 'bg-gain/10 text-gain'}`}
                    >
                      {o.missing ? `${o.missing} missing` : 'Owned'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              {Object.entries(analysis).map(([title, counts]) => (
                <section
                  className="rounded-xl border border-line p-4"
                  key={title}
                >
                  <h2 className="mb-2 font-semibold capitalize">
                    {title === 'curve' ? 'Mana curve' : title}
                  </h2>
                  {Object.entries(counts)
                    .sort(([a], [b]) =>
                      a.localeCompare(b, undefined, { numeric: true }),
                    )
                    .map(([label, n]) => (
                      <div className="mb-2 text-sm" key={label}>
                        <div className="flex justify-between">
                          <span>{label}</span>
                          <span>{n}</span>
                        </div>
                        <ProgressBar
                          className="mt-1.5"
                          value={n}
                          total={Math.max(1, ...Object.values(counts))}
                        />
                      </div>
                    ))}
                </section>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
