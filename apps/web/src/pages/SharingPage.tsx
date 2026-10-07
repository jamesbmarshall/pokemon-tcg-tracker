/**
 * Sharing hub. Two separate mechanisms live here:
 * - Shared collections: real collections with members who can edit or view, opened via the
 *   collection switcher like the personal one.
 * - Share links: read-only snapshots of part of a collection (see ShareDialog), listed here
 *   alongside links other people have shared with this user.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FolderPlus, LogOut, Pencil, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import { collectionsApi, SCOPE_LABEL, SCOPE_NOUN, SHARES_KEY, sharing, type Member } from '../api/sharing';
import type { CollectionSummary } from '../api/backend';
import { useCollectionStore } from '../store/collectionStore';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { ConfirmDialog, FormError, Modal, StatusPill } from '../components/forms';
import { errorText, useSubmit } from '../components/formUtils';
import { ShareRow } from '../components/ShareDialog';
import { PageHeader, Segmented } from '../components/ui';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' } as const;

function NameForm({ title, initial = '', action, onSave, onClose }: { title: string; initial?: string; action: string; onSave: (name: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!name.trim()) throw new Error('Give the collection a name');
    await onSave(name.trim());
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="collection-name" className="mb-1.5 block text-sm font-medium">
            Name
          </label>
          <input id="collection-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Family collection" className="input" />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Members of a shared collection. Everyone can see who's in it; only the owner can change it. */
function MembersDialog({ collection, onClose }: { collection: CollectionSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);
  const key = ['members', collection.id];
  const members = useQuery({ queryKey: key, queryFn: () => collectionsApi.members(collection.id) });
  const users = useQuery({ queryKey: ['users'], queryFn: sharing.users });
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<Member['role']>('editor');
  const owner = collection.role === 'owner';
  // People not already in the collection. The owner isn't in `members`, but is always `me` here.
  const candidates = (users.data ?? []).filter((u) => u.id !== me && !members.data?.some((m) => m.id === u.id));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onErr = (e: unknown) => toast(errorText(e), { tone: 'error' });
  const setMember = useMutation({ mutationFn: (v: { userId: string; role: Member['role'] }) => collectionsApi.setMember(collection.id, v.userId, v.role), onSuccess: refresh, onError: onErr });
  const removeMember = useMutation({ mutationFn: (userId: string) => collectionsApi.removeMember(collection.id, userId), onSuccess: refresh, onError: onErr });

  return (
    <Modal title={`People in ${collection.name}`} onClose={onClose}>
      <ul className="divide-y divide-line">
        <li className="flex items-center gap-3 py-2.5 text-sm">
          <span className="flex-1">{collection.ownerName}</span>
          <StatusPill tone="warn">Owner</StatusPill>
        </li>
        {members.data?.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {m.displayName} <span className="font-mono text-[11px] text-faint">{m.username}</span>
            </span>
            {owner ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) => setMember.mutate({ userId: m.id, role: e.target.value as Member['role'] })}
                  className="input !h-8 !w-auto !text-xs"
                  aria-label={`${m.displayName}'s access`}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button type="button" onClick={() => removeMember.mutate(m.id)} className="btn btn-ghost !h-8 !w-8 !p-0 hover:!text-loss" aria-label={`Remove ${m.displayName}`}>
                  <X size={14} />
                </button>
              </>
            ) : (
              <StatusPill tone="muted">{ROLE_LABEL[m.role]}</StatusPill>
            )}
          </li>
        ))}
      </ul>
      {members.data && !members.data.length && <p className="py-2 text-sm text-muted">Nobody else yet.</p>}

      {owner && (
        <form
          className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pick) return;
            setMember.mutate({ userId: pick, role }, { onSuccess: () => setPick('') });
          }}
        >
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input !h-9 min-w-40 flex-1 !text-sm" aria-label="Person to add">
            <option value="">{candidates.length ? 'Add someone…' : 'Everyone is already here'}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.username})
              </option>
            ))}
          </select>
          <Segmented
            size="sm"
            value={role}
            onChange={setRole}
            options={[
              { value: 'editor', label: 'Can edit' },
              { value: 'viewer', label: 'Can view' },
            ]}
          />
          <button type="submit" disabled={!pick || setMember.isPending} className="btn btn-primary !h-9">
            <UserPlus size={15} /> Add
          </button>
        </form>
      )}
    </Modal>
  );
}

function CollectionsSection() {
  const collections = useCollectionStore((s) => s.collections);
  const current = useCollectionStore((s) => s.collectionId);
  const load = useCollectionStore((s) => s.load);
  const me = useAuth((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<CollectionSummary | null>(null);
  const [members, setMembers] = useState<CollectionSummary | null>(null);
  const [removing, setRemoving] = useState<CollectionSummary | null>(null);
  const [leaving, setLeaving] = useState<CollectionSummary | null>(null);

  // Reloads the collection list and state, staying on the current collection unless told otherwise.
  const reload = (id?: string) => load(id ?? current ?? undefined);

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Collections</h2>
          <p className="mt-1 text-sm text-muted">Your personal collection is yours alone. Shared collections have members who can edit or just view.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="btn btn-ghost">
          <FolderPlus size={16} /> New shared collection
        </button>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {collections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {c.name}
                {c.id === current && <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-accent">Open</span>}
              </p>
              <p className="text-xs text-muted">
                {c.kind === 'personal' ? 'Personal' : 'Shared'}
                {!c.mine && ` · ${c.ownerName}'s`} · {ROLE_LABEL[c.role]}
              </p>
            </div>
            {c.id !== current && (
              <button type="button" onClick={() => void reload(c.id)} className="btn btn-ghost !h-8 !text-xs">
                Open
              </button>
            )}
            {c.kind === 'shared' && (
              <button type="button" onClick={() => setMembers(c)} className="btn btn-ghost !h-8 !text-xs" aria-label={`People in ${c.name}`}>
                <Users size={13} /> People
              </button>
            )}
            {c.role === 'owner' && c.kind === 'shared' && (
              <>
                <button type="button" onClick={() => setRenaming(c)} className="btn btn-ghost !h-8 !w-8 !p-0" aria-label={`Rename ${c.name}`}>
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => setRemoving(c)} className="btn btn-ghost !h-8 !w-8 !p-0 hover:!text-loss" aria-label={`Delete ${c.name}`}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
            {!c.mine && (
              <button type="button" onClick={() => setLeaving(c)} className="btn btn-ghost !h-8 !text-xs" aria-label={`Leave ${c.name}`}>
                <LogOut size={13} /> Leave
              </button>
            )}
          </li>
        ))}
      </ul>

      {creating && (
        <NameForm
          title="New shared collection"
          action="Create"
          onSave={async (name) => {
            const c = await collectionsApi.create(name);
            await reload(c.id);
            toast(`Created ${c.name}. Add people with the People button.`, { tone: 'success' });
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {renaming && (
        <NameForm
          title="Rename collection"
          initial={renaming.name}
          action="Save"
          onSave={async (name) => {
            await collectionsApi.rename(renaming.id, name);
            await reload();
          }}
          onClose={() => setRenaming(null)}
        />
      )}
      {members && <MembersDialog collection={members} onClose={() => setMembers(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          body="Every card, slab, photo, note and list in it is deleted for everyone. Share links to it stop working. This can't be undone."
          action="Delete collection"
          onConfirm={async () => {
            await collectionsApi.remove(removing.id);
            // If the open collection was deleted, fall back to the default pick (usually personal).
            await load(removing.id === current ? undefined : (current ?? undefined));
            toast(`Deleted ${removing.name}`);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {leaving && me && (
        <ConfirmDialog
          title={`Leave ${leaving.name}?`}
          body={`You'll lose access until ${leaving.ownerName} adds you again.`}
          action="Leave"
          onConfirm={async () => {
            // Leaving is removing yourself as a member; the server allows that without owner rights.
            await collectionsApi.removeMember(leaving.id, me);
            await load(leaving.id === current ? undefined : (current ?? undefined));
          }}
          onClose={() => setLeaving(null)}
        />
      )}
    </section>
  );
}

function SharedWithMe() {
  const { data, isLoading, error } = useQuery({ queryKey: ['shares', 'with-me'], queryFn: sharing.sharedWithMe });
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold">Shared with you</h2>
      {isLoading && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {error && <p className="mt-3 text-sm text-loss">{errorText(error)}</p>}
      {data && !data.length && <p className="mt-3 text-sm text-muted">Nothing yet. When someone shares with you or with everyone here, it shows up here.</p>}
      {data && data.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title ?? `${s.ownerName}'s ${SCOPE_NOUN[s.scope]}`}</p>
                <p className="text-xs text-muted">
                  From {s.ownerName} · {SCOPE_LABEL[s.scope]}
                </p>
              </div>
              {/* Path only: the share URL embeds the server's configured public origin, which may differ
                  from the one this user is browsing on, and a path keeps them on the same session. */}
              <a href={new URL(s.url, window.location.origin).pathname} className="btn btn-ghost !h-8 !text-xs">
                <ExternalLink size={13} /> View
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyLinks() {
  const { data, isLoading } = useQuery({ queryKey: SHARES_KEY, queryFn: sharing.mine });
  const [showOld, setShowOld] = useState(false);
  const live = data?.filter((s) => s.active) ?? [];
  const old = data?.filter((s) => !s.active) ?? [];
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold">Your share links</h2>
      <p className="mt-1 text-sm text-muted">
        Make new links with the <Share2 size={12} className="inline" /> Share button on your collection, a set, your wishlist or a list.
      </p>
      {isLoading && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {data && !data.length && <p className="mt-3 text-sm text-muted">You haven't shared anything yet.</p>}
      {live.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {live.map((s) => (
            <ShareRow key={s.id} share={s} showWhat />
          ))}
        </ul>
      )}
      {old.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <button type="button" onClick={() => setShowOld((v) => !v)} className="text-xs text-muted hover:text-fg" aria-expanded={showOld}>
            {showOld ? 'Hide' : 'Show'} {old.length} expired or revoked link{old.length === 1 ? '' : 's'}
          </button>
          {showOld && (
            <ul className="divide-y divide-line">
              {old.map((s) => (
                <ShareRow key={s.id} share={s} showWhat />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function SharingPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Collections & links" title="Sharing">
        Collect together, or let people look without changing anything.
      </PageHeader>
      <CollectionsSection />
      <SharedWithMe />
      <MyLinks />
    </div>
  );
}
