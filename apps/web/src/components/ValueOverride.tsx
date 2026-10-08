import { useState } from 'react';
import { parseAmount } from './Paid';

const show = (v?: number) => (v != null ? v.toFixed(2) : '');

/**
 * Compact "set my value" field for a manual USD valuation, overriding the market price. Mirrors
 * `PaidInput`'s commit-on-blur/Enter/Escape pattern, but for a single plain USD number.
 */
export function ValueInput({ value, onCommit, label, className = '' }: { value?: number; onCommit: (v: number | undefined) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState(show(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(show(value));
  }

  const commit = () => {
    const n = parseAmount(draft);
    if (n === null) return setDraft(show(value));
    if (n === '' ? value == null : value != null && n === value) return setDraft(show(value));
    onCommit(n === '' ? undefined : n);
  };

  return (
    <label className={`group relative flex h-8 items-center rounded-lg border border-line bg-surface-2 pl-2 transition-colors focus-within:border-accent/60 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Value</span>
      <span className="ml-1.5 font-mono text-xs text-muted">$</span>
      <input
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(show(value));
            e.stopPropagation();
          }
        }}
        inputMode="decimal"
        placeholder="—"
        className="h-full w-16 bg-transparent pl-0.5 pr-2 font-mono text-xs text-fg tabular placeholder:text-faint focus:outline-none"
      />
    </label>
  );
}

/** Small "Manual" pill marking a value that comes from a user override rather than the market. */
export function ManualBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Set manually, overriding the market price"
      className={`rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      Manual
    </span>
  );
}
