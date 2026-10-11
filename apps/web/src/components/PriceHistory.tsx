import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { getBackend } from '../api/backend';
import { useFx, useMoney } from '../hooks/useMoney';
import { relativeTime } from '../utils/format';
import { Segmented } from './ui';
import ValueChart from './ValueChart';
import type { PriceHistorySource } from '../api/types';

const HOUR = 1000 * 60 * 60;
const SOURCE_LABEL: Record<PriceHistorySource, string> = { tcgplayer: 'TCGplayer', cardmarket: 'Cardmarket', pricecharting: 'PriceCharting' };
const RANGES = [
  { value: 30 as const, label: '30d' },
  { value: 90 as const, label: '90d' },
  { value: 365 as const, label: '1y' },
];

/**
 * Per-variant price history: a small sparkline you can expand into a bigger chart, with a
 * source toggle (when more than one source has data) and an "updated" note. Renders nothing if
 * neither TCGplayer nor Cardmarket has history for this variant.
 */
export default function PriceHistory({ cardId, variant }: { cardId: string; variant: string }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const [source, setSource] = useState<PriceHistorySource | null>(null);
  const { rates } = useFx();
  const money = useMoney();
  const { data } = useQuery({
    queryKey: ['priceHistory', cardId, days],
    queryFn: () => getBackend().priceHistory(cardId, days),
    staleTime: HOUR,
  });

  const series = useMemo(() => data?.series.filter((s) => s.variant === variant) ?? [], [data, variant]);
  if (!series.length) return null;

  const active = series.find((s) => s.source === source) ?? series[0];
  const toUsd = (price: number) => (active.currency === 'EUR' ? price / (rates.EUR || 0.89) : price);
  const panelId = `price-history-${cardId}-${variant}`.replace(/[^a-zA-Z0-9-]/g, '-');

  return (
    <div className="w-full basis-full" data-testid={`price-history-${variant}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? 'Hide price history' : 'Show price history'}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
        >
          <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          Price history
        </button>
        {series.length > 1 && (
          <Segmented size="sm" value={active.source} onChange={setSource} options={series.map((s) => ({ value: s.source, label: SOURCE_LABEL[s.source] }))} />
        )}
      </div>
      <div id={panelId}>
        <ValueChart
          points={active.points}
          value={(p) => toUsd(p.price)}
          format={(n) => money(n)}
          height={expanded ? 160 : 40}
          maxPoints={days}
          emptyMessage="Price history builds up day by day. Check back soon to see the trend line."
        />
      </div>
      {expanded && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
          <Segmented size="sm" value={days} onChange={setDays} options={RANGES} />
          <p>
            Updated {active.updatedAt ? relativeTime(active.updatedAt) : 'recently'} from{' '}
            {active.url ? (
              <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent">
                {SOURCE_LABEL[active.source]}
              </a>
            ) : (
              SOURCE_LABEL[active.source]
            )}
          </p>
        </div>
      )}
    </div>
  );
}
