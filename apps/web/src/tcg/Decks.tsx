import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  const list = state.lists.find((l) => l.id === listId);
  if (listId)
    return list ? (
      <DeckEditor key={list.id} list={list} />
    ) : (
      <p>List not found.</p>
    );
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-semibold">Lists & decks</h1>
      {!readOnly && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sr-only" htmlFor="tcg-list-name">
            List or deck name
          </label>
          <input
            id="tcg-list-name"
            required
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {['list', ...(module.capabilities.decks ? ['deck'] : [])].map(
            (kind) => (
              <button
                key={kind}
                className="btn btn-primary"
                disabled={busy || !name.trim()}
                onClick={() => {
                  const id = crypto.randomUUID();
                  void save([
                    {
                      kind: 'list',
                      id,
                      data: {
                        id,
                        game: module.id,
                        name,
                        kind,
                        format:
                          kind === 'deck' ? module.formats[0]?.id : undefined,
                        items: [],
                        addedAt: new Date().toISOString(),
                      },
                    },
                  ]).then((ok) => {
                    if (ok) setName('');
                  });
                }}
              >
                Create{' '}
                {kind === 'deck'
                  ? `${module.formats[0]?.name ?? ''} deck`
                  : 'list'}
              </button>
            ),
          )}
        </form>
      )}
      <div className="space-y-3">
        {state.lists.map((l) => (
          <div
            className="flex items-center justify-between rounded-xl border border-line p-4"
            key={l.id}
          >
            <Link
              className="text-lg font-semibold text-accent"
              to={`/${module.id}/lists/${l.id}`}
            >
              {l.name}
              <span className="ml-3 text-sm text-muted">
                {l.kind === 'deck' ? l.format : 'List'} ·{' '}
                {l.items.reduce((n, i) => n + i.quantity, 0)} cards
              </span>
            </Link>
            {!readOnly && (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void remove('list', l.id)}
              >
                Delete
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
    <section className="space-y-3 rounded-xl border border-line p-4">
      <h2 className="font-semibold">Import decklist</h2>
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
          className="ml-2"
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
      <div>
        <h1 className="font-display text-3xl font-semibold">{list.name}</h1>
        <p className="mt-2 text-muted">
          {list.kind === 'deck'
            ? `${total}/${format?.size ?? '?'} cards · ${legality?.status ?? 'Unverified'}`
            : `${total} cards`}{' '}
          · {money(value)}
        </p>
      </div>
      {!readOnly && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save([
              {
                kind: 'list',
                id: list.id,
                data: { ...list, name, description },
              },
            ]);
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
      )}
      {legality && (
        <section
          className="rounded-xl border border-line p-4"
          aria-label="Deck legality"
        >
          <h2 className="font-semibold">
            {legality.status === 'legal'
              ? `Legal in ${format?.name ?? 'format'}`
              : legality.status === 'unverified'
                ? 'Legality needs verification'
                : `${format?.name ?? 'Deck'} rules issues`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {legality.issues.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
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
        <ImportDeck list={list} onDone={() => setImporting(false)} />
      )}
      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
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
      )}
      {(['commander', 'main', 'companion', 'maybeboard'] as const).map((z) => (
        <section key={z} className="space-y-2">
          <h2 className="font-semibold capitalize">{z}</h2>
          {list.items
            .filter((i) => i.zone === z)
            .map((i) => {
              const card = cards.get(i.cardId);
              return (
                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                  key={i.cardId}
                >
                  <Link
                    className="flex-1 text-accent"
                    to={`/${module.id}/card/${encodeURIComponent(i.cardId)}`}
                  >
                    {card?.name ?? i.cardId}
                    <span className="ml-2 text-xs text-muted">
                      {card?.setCode} {card?.number}
                    </span>
                  </Link>
                  {!readOnly && (
                    <>
                      <label className="sr-only" htmlFor={`${z}-${i.cardId}`}>
                        Quantity of {card?.name}
                      </label>
                      <input
                        className="input w-20"
                        id={`${z}-${i.cardId}`}
                        type="number"
                        min="1"
                        max="1000"
                        disabled={busy}
                        value={i.quantity}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (n >= 1 && n <= 1000)
                            void change(
                              list.items.map((x) =>
                                x === i ? { ...x, quantity: n } : x,
                              ),
                            );
                        }}
                      />
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void change(list.items.filter((x) => x !== i))
                        }
                      >
                        Remove
                      </button>
                    </>
                  )}
                  {readOnly && <span>×{i.quantity}</span>}
                </div>
              );
            })}
        </section>
      ))}
      {list.kind === 'deck' && (
        <>
          <section>
            <h2 className="mb-3 font-semibold">Owned vs needed</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Owned</th>
                  <th>Needed</th>
                  <th>Missing</th>
                </tr>
              </thead>
              <tbody>
                {ownership.map((o) => (
                  <tr key={o.cardId}>
                    <td className="py-2">{o.name}</td>
                    <td>{o.owned}</td>
                    <td>{o.needed}</td>
                    <td>{o.missing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
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
                      <meter
                        className="w-full"
                        min={0}
                        max={Math.max(1, ...Object.values(counts))}
                        value={n}
                      >
                        {n}
                      </meter>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
