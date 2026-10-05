import { useEffect, useState } from 'react';
import { legacyImageUrl } from '../api/client';
import { useCachedImage } from '../hooks/useCachedImage';
import { useCollectionStore } from '../store/collectionStore';
import { typeColor } from '../utils/energy';

interface Props {
  id: string;
  src: string;
  name: string;
  number?: string;
  setName?: string;
  types?: string[];
  hires?: boolean;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
}

/**
 * Card art with graceful degradation: local cache → TCGdex → legacy CDN → a printed-style
 * placeholder, so cards without a scan still look intentional rather than broken.
 */
export default function CardImage({ id, src, name, number, setName, types, hires = false, alt = '', className = '', loading = 'lazy', onLoad }: Props) {
  const keep = useCollectionStore((s) => s.byCard.has(id) || s.gradedByCard.has(id) || s.wishlist.has(id));
  const cached = useCachedImage(id, keep && !hires);
  const sources = [cached, src, legacyImageUrl(id, hires)].filter((s): s is string => !!s);
  const key = sources.join('|');
  const [failed, setFailed] = useState({ key: '', n: 0 });
  const current = sources[failed.key === key ? failed.n : 0];

  // The placeholder counts as "loaded" for callers that fade the image in.
  useEffect(() => {
    if (!current) onLoad?.();
  }, [current, onLoad]);

  if (!current) {
    const accent = typeColor(types?.[0]);
    return (
      <div
        role="img"
        aria-label={alt || name}
        className={`relative flex h-full w-full flex-col justify-between overflow-hidden p-[8%] text-left [container-type:inline-size] ${className}`}
        style={{ background: `radial-gradient(120% 70% at 50% 0%, color-mix(in oklab, ${accent} 38%, transparent), transparent 70%), linear-gradient(160deg, #23222d, #121118)` }}
      >
        <div className="absolute inset-[5%] rounded-[4%/3%] border border-white/10" />
        <p className="relative font-display text-[clamp(10px,9cqw,22px)] font-bold leading-tight text-fg/90">{name}</p>
        <div className="relative space-y-0.5">
          {setName && <p className="truncate text-[clamp(8px,6cqw,13px)] text-muted">{setName}</p>}
          {number && <p className="font-mono text-[clamp(8px,6cqw,13px)] text-faint">#{number}</p>}
          <p className="pt-1 text-[clamp(7px,5cqw,11px)] uppercase tracking-[0.14em] text-faint/80">No scan yet</p>
        </div>
      </div>
    );
  }

  return (
    <img
      key={current}
      src={current}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={onLoad}
      onError={() => setFailed({ key, n: (failed.key === key ? failed.n : 0) + 1 })}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
