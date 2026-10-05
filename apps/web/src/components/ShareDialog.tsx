import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, Link2, Share2, Trash2 } from 'lucide-react';
import { AUDIENCE_LABEL, SCOPE_LABEL, SHARES_KEY, sharing, type Share, type ShareAudience, type ShareScope } from '../api/sharing';
import { useCollectionStore } from '../store/collectionStore';
import { useAuth } from '../store/authStore';
import { toast } from '../store/toastStore';
import { formatDate } from '../utils/format';
import { CopyField, FormError, Modal, StatusPill } from './forms';
import { errorText, useSubmit } from './formUtils';
import { Segmented } from './ui';

const EXPIRY = [
  { value: 0, label: 'Never' },
  { value: 1, label: '1 day' },
  { value: 7, label: '1 week' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
];

/** One share link: who can see it, what's hidden, views, and revoke/delete. */
export function ShareRow({ share, showWhat }: { share: Share; showWhat?: boolean }) {
  const qc = useQueryClient();
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: SHARES_KEY });
    toast(msg);
  };
  const revoke = useMutation({ mutationFn: () => sharing.revoke(share.id), onSuccess: () => done('Link revoked'), onError: (e) => toast(errorText(e), { tone: 'error' }) });
  const remove = useMutation({ mutationFn: () => sharing.remove(share.id), onSuccess: () => done('Link deleted'), onError: (e) => toast(errorText(e), { tone: 'error' }) });
  const hidden = [share.hidePaid && 'what you paid', share.hideValue && 'values', share.hideNotes && 'notes'].filter(Boolean);
  const state = share.revokedAt ? 'Revoked' : share.active ? 'Active' : 'Expired';

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={share.active ? 'good' : 'muted'}>{state}</StatusPill>
        <span className="text-sm font-medium">
          {showWhat ? (share.title ?? `${SCOPE_LABEL[share.scope]} · ${share.collectionName}`) : AUDIENCE_LABEL[share.audience]}
        </span>
        {showWhat && <span className="text-xs text-muted">{AUDIENCE_LABEL[share.audience]}</span>}
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-faint" title={share.lastViewedAt ? `Last viewed ${formatDate(share.lastViewedAt)}` : 'Not viewed yet'}>
          <Eye size={11} /> {share.views}
        </span>
      </div>
      {share.audience === 'users' && share.users?.length ? <p className="text-xs text-muted">With {share.users.map((u) => u.displayName).join(', ')}</p> : null}
      <p className="text-xs text-faint">
        {hidden.length ? `Hides ${hidden.join(', ')}` : 'Shows everything'}
        {' · '}
        {share.expiresAt ? `${share.active ? 'Expires' : 'Expired'} ${formatDate(share.expiresAt)}` : 'No expiry'}
      </p>
      {share.active && <CopyField value={share.url} label="Share link" />}
      <div className="flex gap-2">
        {share.active && (
          <button type="button" onClick={() => revoke.mutate()} disabled={revoke.isPending} className="btn btn-ghost !h-8 !text-xs">
            <Ban size={13} /> Revoke
          </button>
        )}
        <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="btn btn-ghost !h-8 !text-xs hover:!text-loss" aria-label="Delete link">
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </li>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-volt)]" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Creates read-only links to a collection, or part of one, and lists the links already made
 * for the same thing. Only the collection's owner can share it.
 */
export default function ShareDialog({ scope, target, what, onClose }: { scope: ShareScope; target?: string; what: string; onClose: () => void }) {
  const collectionId = useCollectionStore((s) => s.collectionId) ?? '';
  const me = useAuth((s) => s.user?.id);
  const qc = useQueryClient();
  const [audience, setAudience] = useState<ShareAudience>('public');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [hidePaid, setHidePaid] = useState(true);
  const [hideValue, setHideValue] = useState(false);
  const [hideNotes, setHideNotes] = useState(true);
  const [days, setDays] = useState(0);

  const shares = useQuery({ queryKey: SHARES_KEY, queryFn: sharing.mine });
  const users = useQuery({ queryKey: ['users'], queryFn: sharing.users, enabled: audience === 'users' });
  const others = users.data?.filter((u) => u.id !== me) ?? [];
  const existing = (shares.data ?? []).filter((s) => s.collectionId === collectionId && s.scope === scope && (s.target ?? undefined) === target);

  const { busy, error, onSubmit } = useSubmit(async () => {
    if (audience === 'users' && !userIds.length) throw new Error('Pick at least one person');
    await sharing.create({
      collectionId,
      scope,
      target,
      audience,
      title: title.trim() || undefined,
      hidePaid,
      hideValue,
      hideNotes,
      expiresInDays: days || undefined,
      userIds: audience === 'users' ? userIds : undefined,
    });
    setTitle('');
    await qc.invalidateQueries({ queryKey: SHARES_KEY });
    toast('Link created. Copy it below.', { tone: 'success' });
  });

  return (
    <Modal title={`Share ${what}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">Who can see it</p>
          <Segmented
            size="sm"
            value={audience}
            onChange={setAudience}
            options={[
              { value: 'public', label: 'Anyone with link' },
              { value: 'instance', label: 'Everyone here' },
              { value: 'users', label: 'Specific people' },
            ]}
          />
          <p className="mt-1.5 text-xs text-muted">
            {audience === 'public'
              ? "No account needed. Anyone you send the link to can view it. Search engines are told not to index it."
              : audience === 'instance'
                ? 'Anyone signed in to this PokéTracker server can open the link.'
                : 'Only the people you pick, once signed in.'}
          </p>
        </div>

        {audience === 'users' && (
          <fieldset className="max-h-40 overflow-y-auto rounded-xl border border-line p-2">
            <legend className="sr-only">People</legend>
            {users.isLoading && <p className="p-2 text-xs text-muted">Loading people…</p>}
            {users.data && !others.length && <p className="p-2 text-xs text-muted">Nobody else has an account yet. Invite someone from the Admin page.</p>}
            {others.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={userIds.includes(u.id)}
                  onChange={(e) => setUserIds((ids) => (e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id)))}
                />
                {u.displayName} <span className="font-mono text-[11px] text-faint">{u.username}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div>
          <label htmlFor="share-title" className="mb-1.5 block text-sm font-medium">
            Title <span className="font-normal text-faint">(optional)</span>
          </label>
          <input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={what} className="input" />
        </div>

        <div className="rounded-xl border border-line px-3 py-1">
          <Toggle label="Hide what I paid" hint="Purchase prices and profit/loss" checked={hidePaid} onChange={setHidePaid} />
          <Toggle label="Hide market values" hint="Card prices, totals and the value chart" checked={hideValue} onChange={setHideValue} />
          <Toggle label="Hide notes" hint="Your private notes on each card" checked={hideNotes} onChange={setHideNotes} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="share-expiry" className="mb-1.5 block text-sm font-medium">
              Expires
            </label>
            <select id="share-expiry" value={days} onChange={(e) => setDays(Number(e.target.value))} className="input !w-auto">
              {EXPIRY.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy || !collectionId} className="btn btn-primary ml-auto">
            <Link2 size={15} /> {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
        <FormError error={error} />
      </form>

      {existing.length > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Links for {what}</h3>
          <ul className="divide-y divide-line">
            {existing.map((s) => (
              <ShareRow key={s.id} share={s} />
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}

/** "Share" button for the collection's owner; nothing for editors and viewers. */
export function ShareButton({ scope, target, what, compact }: { scope: ShareScope; target?: string; what: string; compact?: boolean }) {
  const owner = useCollectionStore((s) => s.role === 'owner' && !s.readOnly);
  const [open, setOpen] = useState(false);
  if (!owner) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`btn btn-ghost ${compact ? '!h-9 !text-xs' : ''}`} aria-label={`Share ${what}`}>
        <Share2 size={compact ? 14 : 16} /> Share
      </button>
      {open && <ShareDialog scope={scope} target={target} what={what} onClose={() => setOpen(false)} />}
    </>
  );
}
