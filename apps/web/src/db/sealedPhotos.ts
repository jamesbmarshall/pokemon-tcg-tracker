/**
 * Sealed-product photos: client-side downscaling, upload/delete through the Backend, and a hook
 * that keeps every view of an item's photos in step. Mirrors db/gradedPhotos.ts; sealed photos
 * have no "side" concept, so there's nothing equivalent to pass there.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getBackend, type PhotoRef } from '../api/backend';
import { useCollectionStore } from '../store/collectionStore';
import { prepareImage } from './gradedPhotos';

/** Bumped whenever a sealed item's photos change so every viewer of them refetches. */
const usePhotoVersions = create<{ v: Record<string, number>; bump: (id: string) => void }>((set) => ({
  v: {},
  bump: (id) => set((s) => ({ v: { ...s.v, [id]: (s.v[id] ?? 0) + 1 } })),
}));

const collectionId = () => {
  const id = useCollectionStore.getState().collectionId;
  if (!id) throw new Error('No collection loaded');
  return id;
};

/** Uploads photos to a sealed item in the active collection. The server rejects it if the user can't edit. */
export async function addSealedPhotos(sealedId: string, files: Blob[]) {
  if (!files.length) return [];
  const prepared = await Promise.all(files.map(prepareImage));
  const out = await getBackend().addSealedPhotos(collectionId(), sealedId, prepared);
  usePhotoVersions.getState().bump(sealedId);
  return out;
}

export async function removeSealedPhotos(ids: string[], sealedId?: string) {
  const cid = collectionId();
  await Promise.all(ids.map((id) => getBackend().deleteSealedPhoto(cid, id)));
  if (sealedId) usePhotoVersions.getState().bump(sealedId);
}

export const sealedPhotosFor = (sealedId: string) => getBackend().sealedPhotos(collectionId(), sealedId);

export type PhotoUrl = Pick<PhotoRef, 'id' | 'url'>;

/** A sealed item's photos (served by the server), refreshed whenever they change. */
export function useSealedPhotos(sealedId: string | undefined) {
  const version = usePhotoVersions((s) => (sealedId ? (s.v[sealedId] ?? 0) : 0));
  const cid = useCollectionStore((s) => s.collectionId);
  const [state, setState] = useState<{ key?: string; photos: PhotoUrl[] }>({ photos: [] });
  const key = sealedId && cid ? `${cid}/${sealedId}/${version}` : undefined;
  useEffect(() => {
    if (!key || !sealedId || !cid) return;
    let live = true;
    getBackend()
      .sealedPhotos(cid, sealedId)
      .then((rows) => live && setState({ key, photos: rows.map((r) => ({ id: r.id, url: r.url })) }))
      .catch(() => live && setState({ key, photos: [] }));
    return () => {
      live = false;
    };
  }, [key, sealedId, cid]);
  return key && state.key === key ? state.photos : NONE;
}

// Stable empty array so consumers' effects don't re-run on every render.
const NONE: PhotoUrl[] = [];
