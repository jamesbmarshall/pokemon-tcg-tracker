/**
 * Graded-copy (slab) photos: client-side downscaling, upload/delete through the Backend, and a
 * hook that keeps every view of a slab's photos in step.
 *
 * Photos are stored on the server and only served to someone who can see the collection (or via
 * a share token), so URLs here are not public. The file lives in db/ for historical reasons:
 * photos used to be stored in IndexedDB.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getBackend, type PhotoRef } from '../api/backend';
import { useCollectionStore } from '../store/collectionStore';
import type { GradedPhoto } from '../api/types';

// Plenty for reading a slab label and spotting surface wear, while keeping uploads small.
const MAX_EDGE = 1600;

/** Downscale large phone photos before upload; falls back to the original file. */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    // Already small in both dimensions and bytes: re-encoding would only lose quality.
    if (scale === 1 && file.size < 1_500_000) {
      bmp.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    // Re-encoding can produce a bigger file (e.g. an already well-compressed JPEG); keep the smaller.
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/** Bumped whenever a slab's photos change so every viewer of them refetches. */
const usePhotoVersions = create<{ v: Record<string, number>; bump: (id: string) => void }>((set) => ({
  v: {},
  bump: (id) => set((s) => ({ v: { ...s.v, [id]: (s.v[id] ?? 0) + 1 } })),
}));

const collectionId = () => {
  const id = useCollectionStore.getState().collectionId;
  if (!id) throw new Error('No collection loaded');
  return id;
};

/** Uploads photos to a graded copy in the active collection. The server rejects it if the user can't edit. */
export async function addPhotos(gradedId: string, files: Blob[], side: GradedPhoto['side'] = 'other') {
  if (!files.length) return [];
  const prepared = await Promise.all(files.map(prepareImage));
  const out = await getBackend().addPhotos(collectionId(), gradedId, prepared, side);
  usePhotoVersions.getState().bump(gradedId);
  return out;
}

export async function removePhotos(ids: string[], gradedId?: string) {
  const cid = collectionId();
  await Promise.all(ids.map((id) => getBackend().deletePhoto(cid, id)));
  if (gradedId) usePhotoVersions.getState().bump(gradedId);
}

export const photosFor = (gradedId: string) => getBackend().photos(collectionId(), gradedId);

export type PhotoUrl = Pick<PhotoRef, 'id' | 'url'>;

/** A slab's photos (served by the server), refreshed whenever they change. */
export function useGradedPhotos(gradedId: string | undefined) {
  const version = usePhotoVersions((s) => (gradedId ? (s.v[gradedId] ?? 0) : 0));
  const cid = useCollectionStore((s) => s.collectionId);
  const [state, setState] = useState<{ key?: string; photos: PhotoUrl[] }>({ photos: [] });
  // The key ties the fetched photos to the collection, slab and version they were fetched for, so
  // stale results are never shown after any of them changes (see the return below).
  const key = gradedId && cid ? `${cid}/${gradedId}/${version}` : undefined;
  useEffect(() => {
    if (!key || !gradedId || !cid) return;
    let live = true;
    getBackend()
      .photos(cid, gradedId)
      .then((rows) => live && setState({ key, photos: rows.map((r) => ({ id: r.id, url: r.url })) }))
      .catch(() => live && setState({ key, photos: [] }));
    return () => {
      live = false;
    };
  }, [key, gradedId, cid]);
  return key && state.key === key ? state.photos : NONE;
}

// Stable empty array so consumers' effects don't re-run on every render.
const NONE: PhotoUrl[] = [];
