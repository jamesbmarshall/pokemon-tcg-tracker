import { Languages } from 'lucide-react';
import { LANGUAGES, langOf, language, type Lang } from '../api/languages';

/** Small "JP" style tag for non-English cards and sets. Renders nothing for English. */
export function LanguageBadge({ id, className = '' }: { id: string; className?: string }) {
  const lang = langOf(id);
  if (lang === 'en') return null;
  const l = language(lang);
  return (
    <span title={l.name} className={`rounded-md border border-paper/20 bg-onyx/80 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none tracking-wide text-paper ${className}`}>
      {l.short}
    </span>
  );
}

export function LanguagePicker({ value, onChange, className = '' }: { value: Lang; onChange: (l: Lang) => void; className?: string }) {
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <Languages size={14} className="pointer-events-none absolute left-2.5 text-faint" />
      <select value={value} onChange={(e) => onChange(e.target.value as Lang)} className="input !h-9 !w-auto !pl-8 !text-xs" aria-label="Card language">
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code === 'en' ? 'English' : `${l.name} · ${l.native}`}
          </option>
        ))}
      </select>
    </label>
  );
}
