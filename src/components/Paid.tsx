import { useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { Paid } from '../api/types';
import type { Currency } from '../store/settingsStore';
import { useFx, useMoney } from '../hooks/useMoney';

const SYMBOL: Record<Currency, string> = { GBP: '£', USD: '$', EUR: '€' };

/** Parses "4.50", "£4.50" or "4,50"; '' means cleared, null means invalid. */
// eslint-disable-next-line react-refresh/only-export-components
export function parseAmount(raw: string): number | '' | null {
  const s = raw.replace(/[£$€\s]/g, '');
  if (!s) return '';
  const n = Number(s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const show = (p?: Paid) => (p ? p.amount.toFixed(2) : '');

/**
 * Compact "what I paid" field. Keeps the currency it was entered in, so £5
 * stays £5 even if exchange rates or the display currency change.
 */
export function PaidInput({ value, onCommit, label, className = '' }: { value?: Paid; onCommit: (p: Paid | undefined) => void; label: string; className?: string }) {
  const { currency } = useFx();
  const [draft, setDraft] = useState(show(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(show(value));
  }
  const cur = value?.currency ?? currency;

  const commit = () => {
    const n = parseAmount(draft);
    if (n === null) return setDraft(show(value));
    if (n === '' ? !value : value && n === value.amount) return setDraft(show(value));
    onCommit(n === '' ? undefined : { amount: n, currency: cur });
  };

  return (
    <label className={`group relative flex h-8 items-center rounded-lg border border-line bg-surface-2 pl-2 transition-colors focus-within:border-volt/60 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Paid</span>
      <span className="ml-1.5 font-mono text-xs text-muted">{SYMBOL[cur]}</span>
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
        className="h-full w-14 bg-transparent pl-0.5 pr-2 font-mono text-xs text-fg tabular placeholder:text-faint focus:outline-none"
      />
    </label>
  );
}

/** "+£3.20 (+40%)" coloured by direction. Values are USD and shown in the display currency. */
export function Gain({ valueUsd, costUsd, className = '', icon, percent = true }: { valueUsd: number; costUsd: number; className?: string; icon?: boolean; percent?: boolean }) {
  const money = useMoney();
  const diff = valueUsd - costUsd;
  const flat = Math.abs(diff) < 0.005;
  const up = diff > 0;
  const tone = flat ? 'text-muted' : up ? 'text-gain' : 'text-loss';
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap font-mono tabular ${tone} ${className}`}>
      {icon && !flat && <Icon size={12} />}
      {flat ? '±' : up ? '+' : '−'}
      {money(Math.abs(diff))}
      {percent && costUsd > 0 && !flat && <span className="opacity-70">({`${up ? '+' : '−'}${Math.abs((diff / costUsd) * 100).toFixed(0)}%`})</span>}
    </span>
  );
}
