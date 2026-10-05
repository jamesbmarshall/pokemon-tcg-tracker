import { useEffect, useState } from 'react';
import { cachedImageUrl, loadCachedImage } from '../db/imageCache';

/** Object URL for a locally cached card image, if one exists. */
export function useCachedImage(id: string, enabled: boolean): string | undefined {
  const [found, setFound] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!enabled || cachedImageUrl(id)) return;
    let live = true;
    void loadCachedImage(id).then((url) => {
      if (live && url) setFound({ id, url });
    });
    return () => {
      live = false;
    };
  }, [id, enabled]);
  if (!enabled) return undefined;
  return cachedImageUrl(id) ?? (found?.id === id ? found.url : undefined);
}
