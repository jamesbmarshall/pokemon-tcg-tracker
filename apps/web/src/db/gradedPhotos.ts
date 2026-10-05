import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from './dexie';
import type { GradedPhoto } from '../api/types';

const MAX_EDGE = 1600;

/** Downscale large phone photos so IndexedDB doesn't fill up; falls back to the original file. */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
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
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

const photoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export async function addPhotos(gradedId: string, files: Blob[], side: GradedPhoto['side'] = 'other') {
  const now = new Date().toISOString();
  const photos: GradedPhoto[] = [];
  for (const f of files) photos.push({ id: photoId(), gradedId, side, blob: await prepareImage(f), addedAt: now });
  if (photos.length) await db.gradedPhotos.bulkPut(photos);
  return photos;
}

export const removePhotos = (ids: string[]) => db.gradedPhotos.bulkDelete(ids);

export const photosFor = (gradedId: string) => db.gradedPhotos.where('gradedId').equals(gradedId).sortBy('addedAt');

export interface PhotoUrl {
  id: string;
  url: string;
}

/** Live list of a slab's photos as object URLs (revoked on change/unmount). */
export function useGradedPhotos(gradedId: string | undefined) {
  const [state, setState] = useState<{ id?: string; photos: PhotoUrl[] }>({ photos: [] });
  useEffect(() => {
    if (!gradedId) return;
    let urls: PhotoUrl[] = [];
    const sub = liveQuery(() => photosFor(gradedId)).subscribe({
      next: (rows) => {
        urls.forEach((p) => URL.revokeObjectURL(p.url));
        urls = rows.map((r) => ({ id: r.id, url: URL.createObjectURL(r.blob) }));
        setState({ id: gradedId, photos: urls });
      },
      error: () => setState({ id: gradedId, photos: [] }),
    });
    return () => {
      sub.unsubscribe();
      urls.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [gradedId]);
  return gradedId && state.id === gradedId ? state.photos : NONE;
}

const NONE: PhotoUrl[] = [];
