import { useState } from 'react';
import { imageSrc } from '../api/client';

/** Set logo, falling back to a typeset name for the ~40 sets with no logo artwork. */
export function SetLogo({ src, name, className = '', fallbackClassName = '' }: { src: string; name: string; className?: string; fallbackClassName?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) {
    return <span className={`font-display font-semibold leading-tight tracking-tight text-fg/85 ${fallbackClassName}`}>{name}</span>;
  }
  return <img src={imageSrc(src)} alt={name} loading="lazy" onError={() => setBroken(src)} className={className} />;
}

/** Set symbol; renders nothing when the set has none. */
export function SetSymbol({ src, className = '' }: { src: string; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) return null;
  return <img src={imageSrc(src)} alt="" loading="lazy" onError={() => setBroken(src)} className={className} />;
}
