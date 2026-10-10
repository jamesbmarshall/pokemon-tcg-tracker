import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { CardSnapshot } from '../api/types';
import type { CustomList } from '../api/backend';
import { useCollectionStore, useReadOnly } from '../store/collectionStore';
import { toast } from '../store/toastStore';
import { useMoney } from '../hooks/useMoney';
import CardTile from '../components/CardTile';
import CardImage from '../components/CardImage';
import { ShareButton } from '../components/ShareDialog';
import { ConfirmDialog, FormError, Modal } from '../components/forms';
import { useSubmit } from '../components/formUtils';
import { EmptyState, PageHeader } from '../components/ui';

function listValue(list: CustomList, cards: Map<string, CardSnapshot>) {
  return list.cards.reduce((sum, id) => {
    const c = cards.get(id);
    return sum + (c ? Math.max(0, ...Object.values(c.prices).map((p) => p ?? 0)) : 0);
  }, 0);
}

function ListForm({ list, onClose }: { list?: CustomList; onClose: (created?: CustomList) => void }) {
  const createList = useCollectionStore((s) => s.createList);
  const updateList = useCollectionStore((s) => s.updateList);
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!name.trim()) throw new Error('Give the list a name');
    if (list) {
      await updateList(list.id, { name: name.trim(), description: description.trim() });
      onClose();
    } else {
      const created = await createList(name.trim(), description.trim() || undefined);
      if (created) onClose(created);
    }
  });
  return (
    <Modal title={list ? 'Edit list' : 'New list'} onClose={() => onClose()}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="list-name" className="mb-1.5 block text-sm font-medium">
            Name
          </label>
          <input id="list-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Trade binder" className="input" />
        </div>
        <div>
          <label htmlFor="list-desc" className="mb-1.5 block text-sm font-medium">
            Description <span className="font-normal text-faint">(optional)</span>
          </label>
          <textarea id="list-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} className="input !h-auto py-2" />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onClose()} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {list ? 'Save' : 'Create list'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ListsPage() {
  const lists = useCollectionStore((s) => s.lists);
  const cards = useCollectionStore((s) => s.cards);
  const isLoaded = useCollectionStore((s) => s.isLoaded);
  const readOnly = useReadOnly();
  const money = useMoney();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${lists.length} list${lists.length === 1 ? '' : 's'}`}
        title="Lists"
        actions={
          !readOnly && (
            <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
              <Plus size={16} /> New list
            </button>
          )
        }
      >
        Decks, trade binders, cards to grade: group cards however you like. A card can be in any number of lists, owned or not.
      </PageHeader>

      {isLoaded && !lists.length ? (
        <EmptyState icon={<ListChecks size={22} />} title="No lists yet">
          {readOnly ? 'Nobody has made a list in this collection.' : 'Start one here, or use the Lists button on any card page.'}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lists.map((l) => (
            <li key={l.id}>
              <Link to={`/lists/${l.id}`} className="panel group flex gap-4 p-4 transition-colors hover:border-line-strong">
                <div className="flex -space-x-8">
                  {l.cards.slice(0, 3).map((id) => {
                    const c = cards.get(id);
                    return (
                      <div key={id} className="w-14 shrink-0 overflow-hidden rounded-[4.5%/3.2%] ring-1 ring-line">
                        {c ? <CardImage id={c.id} src={c.image} name={c.name} number={c.number} setName={c.setName} /> : <div className="aspect-[63/88] bg-surface-2" />}
                      </div>
                    );
                  })}
                  {!l.cards.length && <div className="aspect-[63/88] w-14 rounded-[4.5%/3.2%] border border-dashed border-line" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold group-hover:text-volt">{l.name}</p>
                  <p className="font-mono text-xs text-muted tabular">
                    {l.cards.length} card{l.cards.length === 1 ? '' : 's'} · {money(listValue(l, cards))}
                  </p>
                  {l.description && <p className="mt-1 line-clamp-2 text-xs text-faint">{l.description}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <ListForm
          onClose={(created) => {
            setCreating(false);
            if (created) navigate(`/lists/${created.id}`);
          }}
        />
      )}
    </div>
  );
}

export function ListPage() {
  const { listId = '' } = useParams();
  const list = useCollectionStore((s) => s.lists.find((l) => l.id === listId));
  const isLoaded = useCollectionStore((s) => s.isLoaded);
  const cards = useCollectionStore((s) => s.cards);
  const toggleInList = useCollectionStore((s) => s.toggleInList);
  const updateList = useCollectionStore((s) => s.updateList);
  const deleteList = useCollectionStore((s) => s.deleteList);
  const readOnly = useReadOnly();
  const money = useMoney();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const items = useMemo(() => (list?.cards ?? []).map((id) => cards.get(id)).filter((c): c is CardSnapshot => !!c), [list, cards]);

  if (!list) {
    if (!isLoaded) return null;
    return (
      <EmptyState icon={<ListChecks size={22} />} title="List not found" action={<Link to="/lists" className="btn btn-ghost">All lists</Link>}>
        It may have been deleted, or it's in another collection.
      </EmptyState>
    );
  }

  const move = (index: number, delta: number) => {
    const order = [...list.cards];
    const [id] = order.splice(index, 1);
    order.splice(index + delta, 0, id);
    void updateList(list.id, { order });
  };

  return (
    <div className="space-y-6">
      <Link to="/lists" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft size={15} /> Lists
      </Link>
      <PageHeader
        eyebrow={`${list.cards.length} card${list.cards.length === 1 ? '' : 's'} · ${money(listValue(list, cards))}`}
        title={list.name}
        actions={
          !readOnly && (
            <>
              <ShareButton scope="list" target={list.id} what={list.name} compact />
              <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost !h-9 !text-xs">
                <Pencil size={14} /> Edit
              </button>
              <button type="button" onClick={() => setDeleting(true)} className="btn btn-ghost !h-9 !text-xs hover:!text-loss">
                <Trash2 size={14} /> Delete
              </button>
            </>
          )
        }
      >
        {list.description}
      </PageHeader>

      {items.length ? (
        <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((c, i) => (
            <div key={c.id}>
              <CardTile card={c} showSet index={i} />
              {!readOnly && (
                <div className="mt-1.5 flex gap-1 px-0.5">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="btn btn-ghost !h-7 !w-7 !p-0" aria-label={`Move ${c.name} earlier`}>
                    <ArrowLeft size={12} />
                  </button>
                  <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="btn btn-ghost !h-7 !w-7 !p-0" aria-label={`Move ${c.name} later`}>
                    <ArrowRight size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await toggleInList(list.id, c);
                      toast(`Removed ${c.name} from ${list.name}`, { action: { label: 'Undo', run: () => void toggleInList(list.id, c) } });
                    }}
                    className="btn btn-ghost ml-auto !h-7 !w-7 !p-0 hover:!text-loss"
                    aria-label={`Remove ${c.name} from list`}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<ListChecks size={22} />} title="This list is empty" action={!readOnly && <Link to="/search" className="btn btn-ghost">Find cards</Link>}>
          {readOnly ? 'No cards yet.' : 'Open any card and use the Lists button to add it here.'}
        </EmptyState>
      )}

      {editing && <ListForm list={list} onClose={() => setEditing(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete list?"
          body={`"${list.name}" will be deleted. The cards stay in your collection.`}
          action="Delete list"
          onConfirm={async () => {
            await deleteList(list.id);
            navigate('/lists');
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
