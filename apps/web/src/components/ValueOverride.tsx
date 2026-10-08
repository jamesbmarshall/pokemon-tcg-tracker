import { useState } from 'react';
import { parseAmount } from './Paid';
import { useFx } from '../hooks/useMoney';

const SYMBOL = { GBP: '£', USD: '$', EUR: '€' } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compact "set my value" field overriding the market price. The value is stored in USD like every
 * other valuation, but shown and typed in the display currency (as GradedForm does). Mirrors
 * `PaidInput`'s commit-on-blur/Enter/Escape pattern.
 */
export function ValueInput({ value, onCommit, label, className = '' }: { value?: number; onCommit: (v: number | undefined) => void; label: string; className?: string }) {
  const { currency, rate } = useFx();
  const show = (usd?: number) => (usd != null ? (usd * rate).toFixed(2) : '');
  const [draft, setDraft] = useState(show(value));
  const [synced, setSynced] = useState({ value, rate });
  if (synced.value !== value || synced.rate !== rate) {
    setSynced({ value, rate });
    setDraft(show(value));
  }

  const commit = () => {
    const n = parseAmount(draft);
    if (n === null) return setDraft(show(value));
    if (n === '' ? value == null : value != null && n.toFixed(2) === show(value)) return setDraft(show(value));
    onCommit(n === '' ? undefined : round2(n / rate));
  };

  return (
    <label className={`group relative flex h-8 items-center rounded-lg border border-line bg-surface-2 pl-2 transition-colors focus-within:border-accent/60 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Value</span>
      <span className="ml-1.5 font-mono text-xs text-muted">{SYMBOL[currency]}</span>
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
