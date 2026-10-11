import { useMemo, useState } from 'react';
import type { ValuePoint } from '../api/types';
import { formatDate } from '../utils/format';

interface Props {
  points: ValuePoint[];
  format: (usd: number) => string;
  height?: number;
  /** 'gain' plots market value minus cost for copies with a recorded purchase price. */
  metric?: 'value' | 'gain';
}

const gainOf = (p: ValuePoint) => (p.costUsd == null ? undefined : (p.costedValueUsd ?? 0) - p.costUsd);

const W = 600;

export default function ValueChart({ points, format, height = 160, metric = 'value' }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const gain = metric === 'gain';
  const data = useMemo(
    () =>
      [...points]
        .filter((p) => !gain || gainOf(p) !== undefined)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-90),
    [points, gain],
  );

  if (data.length < 2) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-line text-center text-xs text-faint" style={{ height }}>
        <p className="max-w-60">
          {gain
            ? 'Gain and loss is tracked daily from the first day you record what you paid. Check back tomorrow.'
            : 'Your value history builds up day by day. Come back tomorrow to see the trend line.'}
        </p>
      </div>
    );
  }

  const values = data.map((d) => (gain ? gainOf(d)! : d.valueUsd));
  const min = Math.min(...values, ...(gain ? [0] : []));
  const max = Math.max(...values, ...(gain ? [0] : []));
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1;
  const lo = gain ? min - pad : Math.max(0, min - pad);
  const hi = max + pad;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const base = gain ? y(0) : height;
  const area = `${line} L${W},${base} L0,${base} Z`;
  const up = gain ? values[values.length - 1] >= 0 : values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--color-gain)' : 'var(--color-loss)';
  const h = hover ?? data.length - 1;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full overflow-visible"
        style={{ height }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="vc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="1" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#vc-fill)" />
        {gain && <line x1="0" x2={W} y1={base} y2={base} stroke="var(--color-faint)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" data-testid="zero-line" />}
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={x(h)} x2={x(h)} y1="0" y2={height} stroke="var(--color-line-strong)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-surface"
        style={{ left: `${(x(h) / W) * 100}%`, top: y(values[h]), background: stroke }}
      />
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-faint">
        <span>{formatDate(data[0].date)}</span>
        <span className="text-muted">
          {formatDate(data[h].date)} · <span className="text-fg">{gain ? `${values[h] >= 0 ? '+' : '−'}${format(Math.abs(values[h]))}` : format(values[h])}</span>
        </span>
        <span>{formatDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}
