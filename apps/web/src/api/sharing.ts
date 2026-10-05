import { api } from './http';
import type { CollectionRole, CollectionSummary, CustomList, PhotoRef } from './backend';
import type { CardNote, CardSnapshot, CollectionEntry, GradedCopy, SetStat, ValuePoint, WishlistEntry } from './types';

export type ShareScope = 'collection' | 'set' | 'wishlist' | 'graded' | 'list';
export type ShareAudience = 'public' | 'users' | 'instance';

export interface Share {
  id: string;
  collectionId: string;
  collectionName: string;
  scope: ShareScope;
  target: string | null;
  audience: ShareAudience;
  title: string | null;
  hidePaid: boolean;
  hideValue: boolean;
  hideNotes: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
  views: number;
  lastViewedAt: string | null;
  users?: { id: string; displayName: string }[];
  url: string;
  ownerName?: string;
}

export interface ShareInput {
  collectionId: string;
  scope: ShareScope;
  target?: string;
  audience: ShareAudience;
  title?: string;
  hidePaid: boolean;
  hideValue: boolean;
  hideNotes: boolean;
  /** Days from now, or null for no expiry */
  expiresInDays?: number | null;
  userIds?: string[];
}

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
}

export interface Member extends UserRef {
  role: Exclude<CollectionRole, 'owner'>;
}

export interface PublicShare {
  share: {
    scope: ShareScope;
    target: string | null;
    title: string | null;
    ownerName: string;
    hidePaid: boolean;
    hideValue: boolean;
    hideNotes: boolean;
    expiresAt: string | null;
  };
  role: 'viewer';
  entries: CollectionEntry[];
  graded: GradedCopy[];
  wishlist: WishlistEntry[];
  notes: CardNote[];
  history: ValuePoint[];
  lists: CustomList[];
  cards: CardSnapshot[];
  setStats: SetStat[];
}

export const SHARES_KEY = ['shares', 'mine'] as const;

const enc = encodeURIComponent;

/** Turns the dialog's "expires in" choice into the API's fields (null clears the expiry). */
function expiry(days: number | null | undefined) {
  if (days === undefined) return {};
  return days === null ? { expiresAt: null } : { expiresInDays: days };
}

export const sharing = {
  mine: () => api<Share[]>('/api/shares'),
  sharedWithMe: () => api<Share[]>('/api/shared-with-me'),
  create: ({ expiresInDays, ...rest }: ShareInput) => api<Share>('/api/shares', { method: 'POST', body: { ...rest, ...expiry(expiresInDays) } }),
  update: (id: string, { expiresInDays, ...rest }: Partial<Omit<ShareInput, 'collectionId' | 'scope' | 'target'>>) =>
    api<Share>(`/api/shares/${enc(id)}`, { method: 'PATCH', body: { ...rest, ...expiry(expiresInDays) } }),
  revoke: (id: string) => api(`/api/shares/${enc(id)}/revoke`, { method: 'POST' }),
  remove: (id: string) => api(`/api/shares/${enc(id)}`, { method: 'DELETE' }),
  users: () => api<UserRef[]>('/api/users'),
  open: (token: string) => api<PublicShare>(`/api/public/${enc(token)}`, { quiet401: true }),
  publicPhotos: async (token: string, gradedId: string): Promise<PhotoRef[]> => {
    const rows = await api<Omit<PhotoRef, 'url'>[]>(`/api/public/${enc(token)}/graded/${enc(gradedId)}/photos`);
    return rows.map((p) => ({ ...p, url: `/api/public/${enc(token)}/photos/${enc(p.id)}` }));
  },
};

export const collectionsApi = {
  create: (name: string) => api<CollectionSummary>('/api/collections', { method: 'POST', body: { name } }),
  rename: (id: string, name: string) => api(`/api/collections/${enc(id)}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => api(`/api/collections/${enc(id)}`, { method: 'DELETE' }),
  members: (id: string) => api<Member[]>(`/api/collections/${enc(id)}/members`),
  setMember: (id: string, userId: string, role: Member['role']) => api(`/api/collections/${enc(id)}/members/${enc(userId)}`, { method: 'PUT', body: { role } }),
  removeMember: (id: string, userId: string) => api(`/api/collections/${enc(id)}/members/${enc(userId)}`, { method: 'DELETE' }),
};

export const SCOPE_LABEL: Record<ShareScope, string> = {
  collection: 'Whole collection',
  set: 'One set',
  wishlist: 'Wishlist',
  graded: 'Graded cards',
  list: 'Custom list',
};

/** How a share reads after an owner's name: "Misty's wishlist". */
export const SCOPE_NOUN: Record<ShareScope, string> = {
  collection: 'collection',
  set: 'set',
  wishlist: 'wishlist',
  graded: 'graded cards',
  list: 'list',
};

export const AUDIENCE_LABEL: Record<ShareAudience, string> = {
  public: 'Anyone with the link',
  users: 'Specific people',
  instance: 'Everyone on this server',
};
