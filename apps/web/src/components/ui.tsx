import { useId, type ReactNode } from 'react';
import { TYPE_META } from '../utils/energy';
import { pct } from '../utils/format';

export function Logo({ size = 30 }: { size?: number }) {
  const id = useId();
  const foil = `url(#${CSS.escape(id)})`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd23f" />
          <stop offset="0.45" stopColor="#ff8ad8" />
          <stop offset="1" stopColor="#7ad7ff" />
        </linearGradient>
      </defs>
      <rect x="7" y="3" width="19" height="25" rx="3.5" fill="#1c1c27" stroke={foil} strokeWidth="1.6" transform="rotate(10 16 16)" />
      <rect x="5" y="4" width="19" height="25" rx="3.5" fill="#15151d" stroke="#ffffff22" />
      <circle cx="14.5" cy="16.5" r="5.2" fill="none" stroke={foil} strokeWidth="1.8" />
      <path d="M9.3 16.5h10.4" stroke={foil} strokeWidth="1.8" />
      <circle cx="14.5" cy="16.5" r="1.7" fill="#15151d" stroke={foil} strokeWidth="1.6" />
    </svg>
  );
}

export function Energy({ type, size = 20, title }: { type: string; size?: number; title?: string }) {
  const meta = TYPE_META[type] ?? TYPE_META.Colorless;
  const Icon = meta.icon;
  return (
    <span
      title={title ?? type}
      className="inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-black/30"
      style={{ width: size, height: size, background: meta.color }}
    >
      <Icon size={size * 0.58} strokeWidth={2.6} color={type === 'Colorless' || type === 'Lightning' || type === 'Metal' ? '#1b1b1b' : '#fff'} />
    </span>
  );
}

export function ProgressRing({ value, total, size = 56, stroke = 5, label }: { value: number; total: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = pct(value, total);
  const complete = total > 0 && value >= total;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-holo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd23f" />
            <stop offset="0.5" stopColor="#ff8ad8" />
            <stop offset="1" stopColor="#7ad7ff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={complete ? 'url(#ring-holo)' : 'var(--color-volt)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (p / 100) * c}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-semibold tabular">{label ?? `${Math.floor(p)}%`}</span>
    </div>
  );
}

export function ProgressBar({ value, total, className = '' }: { value: number; total: number; className?: string }) {
  const p = pct(value, total);
  const complete = total > 0 && value >= total;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${complete ? 'holo-bar' : 'bg-volt'}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-2 ${className}`} />;
}

export function CardSkeletonGrid({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[63/88] w-full !rounded-[4.5%/3.2%]" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ title, error, onRetry, children }: { title: string; error?: unknown; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="panel p-8 text-center" role="alert">
      <p className="font-semibold text-loss">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        {error instanceof Error ? error.message : 'Something went wrong.'} The card API is sometimes flaky, so it's usually worth another go.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {onRetry && (
          <button onClick={onRetry} className="btn btn-primary">
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-line bg-surface-2 text-volt">{icon}</div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          aria-label={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors ${size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'} ${
            value === o.value ? 'bg-surface-3 text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
