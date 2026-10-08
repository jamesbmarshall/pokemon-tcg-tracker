import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useSets } from '../api/hooks';
import { getBackend } from '../api/backend';
import type { MoverCard } from '../api/types';
import { useCollectionStore, sealedValue } from '../store/collectionStore';
import { useCollectionStats } from '../hooks/useCollectionStats';
import { useMoney } from '../hooks/useMoney';
import ValueChart from '../components/ValueChart';
import { SetLogo, SetSymbol } from '../components/SetArt';
import CardImage from '../components/CardImage';
import { ProgressBar, Segmented, Skeleton } from '../components/ui';
import { Gain } from '../components/Paid';
import type { CostBasis } from '../store/collectionStore';

import { useViewPref } from '../hooks/useViewPrefs';
import { formatDate, pct, relativeTime, todayKey } from '../utils/format';
import { formatGrade } from '../utils/grading';
import { variantLabel } from '../utils/variants';

function gainPct({ valueUsd, costUsd }: CostBasis) {
  if (!costUsd || Math.abs(valueUsd - costUsd) < 0.005) return '';
  const p = ((valueUsd - costUsd) / costUsd) * 100;
  return `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}% `;
}

function Delta({ now, then, money }: { now: number; then?: number; money: (n: number) => string }) {
  if (then === undefined || then === 0) return null;
  const diff = now - then;
  const p = (diff / then) * 100;
  if (Math.abs(diff) < 0.005) return <span className="text-xs text-muted">No change</span>;
  const up = diff > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs font-medium tabular ${up ? 'text-gain' : 'text-loss'}`}>
      <Icon size={13} />
      {up ? '+' : '−'}
      {money(Math.abs(diff))} ({Math.abs(p).toFixed(1)}%)
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="border-t border-line py-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-display text-[1.75rem] font-medium leading-none tabular">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const STEPS = [
  { title: 'Tap to collect', body: 'Every card lists its printings: normal, reverse holo, holo. Tap one to add a copy; right-click to take one away.' },
  { title: 'Count it properly', body: 'Base, full and master completion are tracked separately, so secret rares and reverse holos are counted.' },
  { title: 'Flip the binder', body: 'A virtual 9-pocket binder shows each set page by page, with empty pockets for what is still missing.' },
];

function Welcome() {
  const { data: sets, isLoading } = useSets();
  const latest = sets?.slice(0, 5) ?? [];
  return (
    <div className="space-y-14">
      <section className="grid gap-10 border-b border-line pb-12 pt-4 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <div>
          <p className="eyebrow">A ledger for your binders</p>
          <h1 className="mt-4 max-w-2xl font-display text-[2.6rem] font-medium leading-[1.05] tracking-tight sm:text-[3.6rem]">
            Every card you own, and every one you don't.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">
            Tick off sets as you open packs, chase master sets down to the last reverse holo, and see what the lot is worth. Your collection stays on this device.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {latest[0] && (
              <Link to={`/sets/${latest[0].id}`} className="btn btn-primary">
                Start with {latest[0].name} <ArrowRight size={16} />
              </Link>
            )}
            <Link to="/sets" className="btn btn-ghost">
              Browse all sets
            </Link>
          </div>
        </div>
        <ol className="self-end">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="flex gap-4 border-t border-line py-4">
              <span className="font-mono text-xs text-faint tabular">0{i + 1}</span>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 font-display text-2xl font-medium">Latest releases</h2>
        <div className="divide-y divide-line border-y border-line">
          {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="my-3 h-12" />)}
          {latest.map((s) => (
            <Link key={s.id} to={`/sets/${s.id}`} className="group flex items-center gap-5 py-3 transition-colors hover:bg-surface-2/60 sm:px-2">
              <span className="grid h-12 w-24 shrink-0 place-items-center">
                <SetLogo src={s.images.logo} name={s.name} className="max-h-12 w-auto max-w-full object-contain drop-shadow-logo" fallbackClassName="text-sm" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.series}</span>
              </span>
              <span className="hidden font-mono text-xs text-muted tabular sm:block">{formatDate(s.releaseDate)} · {s.total} cards</span>
              <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  const isLoaded = useCollectionStore((s) => s.isLoaded);
  const history = useCollectionStore((s) => s.history);
  const wishlist = useCollectionStore((s) => s.wishlist);
  const sealed = useCollectionStore((s) => s.sealed);
  const cards = useCollectionStore((s) => s.cards);
  const collectionId = useCollectionStore((s) => s.collectionId);
  const stats = useCollectionStats();
  const money = useMoney();
  const { data: allSets } = useSets();
  const [chart, setChart] = useViewPref<'value' | 'gain'>('home.chart', 'value', ['value', 'gain']);
  const [moversDays, setMoversDays] = useViewPref<'7' | '30'>('home.moversDays', '7', ['7', '30']);
  const { data: movers, isLoading: moversLoading } = useQuery({
    queryKey: ['movers', collectionId, moversDays],
    queryFn: () => getBackend().movers(collectionId!, Number(moversDays) as 7 | 30),
    enabled: !!collectionId,
    staleTime: 5 * 60_000,
  });

  const then = useMemo(() => {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const d = new Date(`${todayKey()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    const cutoff = d.toISOString().slice(0, 10);
    return sorted.find((p) => p.date >= cutoff && p !== sorted[sorted.length - 1])?.valueUsd;
  }, [history]);

  const inProgress = useMemo(
    () =>
      [...stats.sets]
        .map((s) => ({ ...s, p: pct(s.baseOwned, s.printedTotal) }))
        .sort((a, b) => (a.p >= 100 ? 1 : 0) - (b.p >= 100 ? 1 : 0) || b.p - a.p)
        .slice(0, 6),
    [stats.sets],
  );
  const setLogo = useMemo(() => new Map(allSets?.map((s) => [s.id, s.images]) ?? []), [allSets]);
  const top = useMemo(() => [...stats.owned].sort((a, b) => b.topPrice - a.topPrice).slice(0, 8), [stats.owned]);
  const recent = useMemo(() => [...stats.owned].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 8), [stats.owned]);
  const wishCost = useMemo(() => {
    let t = 0;
    for (const id of wishlist.keys()) {
      const c = cards.get(id);
      const ps = c ? Object.values(c.prices).filter(Boolean) : [];
      if (ps.length) t += Math.min(...ps);
    }
    return t;
  }, [wishlist, cards]);
  const sealedStats = useMemo(() => {
    let count = 0;
    let valueUsd = 0;
    for (const item of sealed.values()) {
      if (item.status === 'sealed') count++;
      valueUsd += sealedValue(item);
    }
    return { count, valueUsd };
  }, [sealed]);

  if (!isLoaded) return <Skeleton className="h-80" />;
  if (stats.count === 0) return <Welcome />;

  return (
    <div className="space-y-14">
      {/* Ledger */}
      <section className="grid gap-x-14 gap-y-8 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <p className="eyebrow">Collection value</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <p className="font-display text-[3.25rem] font-medium leading-none tracking-tight tabular sm:text-[4.25rem]">{money(stats.valueUsd)}</p>
            <Delta now={stats.valueUsd} then={then} money={(n) => money(n)} />
          </div>
          <p className="mt-2 text-xs text-muted">Market prices, converted at today's rate</p>
          {stats.cost.costed > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span>
                Paid <span className="font-mono text-fg tabular">{money(stats.cost.costUsd)}</span> for {stats.cost.costed === stats.count ? 'everything' : `${stats.cost.costed} of ${stats.count} cards`}, now worth{' '}
                <span className="font-mono text-fg tabular">{money(stats.cost.valueUsd)}</span>
              </span>
              <Gain valueUsd={stats.cost.valueUsd} costUsd={stats.cost.costUsd} icon className="text-sm font-semibold" />
            </p>
          )}
          <div className="mt-6">
            {stats.cost.costed > 0 && (
              <div className="mb-3 flex justify-end">
                <Segmented
                  size="sm"
                  value={chart}
                  onChange={setChart}
                  options={[
                    { value: 'value', label: 'Value' },
                    { value: 'gain', label: 'Gain / loss' },
                  ]}
                />
              </div>
            )}
            <ValueChart points={history} format={(n) => money(n)} height={160} metric={stats.cost.costed > 0 ? chart : 'value'} />
          </div>
        </div>
        <div className="grid grid-cols-2 content-start gap-x-8 self-start lg:pt-1">
          <Stat label="Cards" value={stats.count.toLocaleString('en-GB')} hint={`${stats.unique.toLocaleString('en-GB')} unique`} />
          <Stat label="Sets started" value={stats.sets.length} hint={`${stats.completedSets} complete`} />
          {stats.cost.costed > 0 ? (
            <Stat
              label="Gain / loss"
              value={<Gain valueUsd={stats.cost.valueUsd} costUsd={stats.cost.costUsd} percent={false} className="!font-display" />}
              hint={`${gainPct(stats.cost)}on ${stats.cost.costed} card${stats.cost.costed === 1 ? '' : 's'} with a price paid`}
            />
          ) : (
            <Stat label="Avg. card" value={money(stats.count ? stats.valueUsd / stats.count : 0)} hint="per copy" />
          )}
          <Link to="/wishlist" className="group border-t border-line py-4">
            <p className="eyebrow">Wishlist</p>
            <p className="mt-1.5 font-display text-[1.75rem] font-medium leading-none tabular group-hover:text-accent">{wishlist.size}</p>
            <p className="mt-1.5 text-xs text-muted">{wishlist.size ? `≈ ${money(wishCost, { compact: true })} to buy` : 'Nothing yet'}</p>
          </Link>
          <Link to="/sealed" className="group border-t border-line py-4">
            <p className="eyebrow">Sealed</p>
            <p className="mt-1.5 font-display text-[1.75rem] font-medium leading-none tabular group-hover:text-accent">{sealedStats.count}</p>
            <p className="mt-1.5 text-xs text-muted">{sealedStats.count ? `≈ ${money(sealedStats.valueUsd, { compact: true })} value` : 'Nothing yet'}</p>
          </Link>
        </div>
      </section>

      {/* Sets in progress */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="font-display text-2xl font-medium">Sets in progress</h2>
          <Link to="/sets?filter=started" className="text-sm text-muted hover:text-accent">
            All sets →
          </Link>
        </div>
        <div className="grid border-t border-line sm:grid-cols-2 sm:gap-x-10 xl:grid-cols-3">
          {inProgress.map((s) => (
            <Link key={s.setId} to={`/sets/${s.setId}`} className="group flex flex-col gap-2 border-b border-line py-4">
              <div className="flex items-center gap-2">
                {setLogo.get(s.setId) && <SetSymbol src={setLogo.get(s.setId)!.symbol} className="h-4 w-4 object-contain" />}
                <p className="min-w-0 flex-1 truncate font-medium group-hover:text-accent">{s.setName}</p>
                <span className="font-mono text-xs text-muted tabular">{Math.floor(s.p)}%</span>
              </div>
              <ProgressBar value={s.baseOwned} total={s.printedTotal} />
              <div className="flex items-center justify-between gap-3 text-xs text-muted tabular">
                <span>
                  {s.baseOwned}/{s.printedTotal} base
                  {s.uniqueOwned > s.baseOwned && ` + ${s.uniqueOwned - s.baseOwned} secret`}
                  {s.p >= 100 ? ' · complete ✦' : ` · ${s.printedTotal - s.baseOwned} to go`}
                </span>
                <span className="font-mono text-[11px] text-faint">{money(s.valueUsd, { compact: true })}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section className="grid gap-12 xl:grid-cols-2">
        <Strip title="Most valuable" link="/collection?sort=value">
          {top.map((o) => (
            <MiniCard key={o.card.id} o={o} line={money(o.topPrice)} />
          ))}
        </Strip>
        <Strip title="Recently added" link="/collection?sort=added">
          {recent.map((o) => (
            <MiniCard key={o.card.id} o={o} line={relativeTime(o.addedAt)} sub={o.entries[0] ? variantLabel(o.entries[0].variant) : formatGrade(o.graded[0])} />
          ))}
        </Strip>
      </section>

      {/* Biggest movers */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-2xl font-medium">Biggest movers</h2>
          <Segmented
            size="sm"
            value={moversDays}
            onChange={setMoversDays}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </div>
        {moversLoading ? (
          <div className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : movers && (movers.gainers.length > 0 || movers.losers.length > 0) ? (
          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <MoversList title="Rising" items={movers.gainers} money={money} />
            <MoversList title="Falling" items={movers.losers} money={money} />
          </div>
        ) : (
          <p className="border-y border-line py-8 text-center text-sm text-muted">Check back once there's more price history to compare.</p>
        )}
      </section>

      {inProgress.some((s) => s.p < 100) && (
        <section className="border-y border-line py-5">
          <p className="eyebrow mb-2">Closest to complete</p>
          {inProgress.filter((s) => s.p < 100).slice(0, 3).map((s) => (
            <div key={s.setId} className="flex items-center gap-4 py-2">
              <span className="w-40 truncate text-sm">{s.setName}</span>
              <ProgressBar value={s.baseOwned} total={s.printedTotal} />
              <span className="w-24 text-right font-mono text-xs text-muted tabular">{s.printedTotal - s.baseOwned} to go</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Strip({ title, link, children }: { title: string; link: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-display text-2xl font-medium">{title}</h2>
        <Link to={link} className="text-sm text-muted hover:text-accent">
          See all →
        </Link>
      </div>
      <div className="scroll-x -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 xl:mx-0 xl:px-0 xl:[mask-image:linear-gradient(to_right,#000_calc(100%-48px),transparent)]">{children}</div>
    </div>
  );
}

function MiniCard({ o, line, sub }: { o: { card: { id: string; name: string; image: string; setName: string; types?: string[] } }; line: string; sub?: string }) {
  return (
    <Link to={`/card/${o.card.id}`} className="group w-[118px] shrink-0 snap-start">
      <div className="aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] shadow-card transition duration-300 group-hover:-translate-y-1 group-hover:shadow-card-lift">
        <CardImage id={o.card.id} src={o.card.image} name={o.card.name} setName={o.card.setName} types={o.card.types} alt={o.card.name} />
      </div>
      <p className="mt-2 truncate text-xs font-medium">{o.card.name}</p>
      <p className="truncate font-mono text-[10.5px] text-muted">{line}</p>
      {sub && <p className="truncate text-[10px] text-faint">{sub}</p>}
    </Link>
  );
}

function MoversList({ title, items, money }: { title: string; items: MoverCard[]; money: (n: number) => string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((m) => (
          <li key={`${m.cardId}::${m.variant}`}>
            <Link to={`/card/${m.cardId}`} className="group flex items-center gap-3 py-2.5">
              <span className="h-11 w-8 shrink-0 overflow-hidden rounded-[4.5%/3.2%] shadow-card">
                <CardImage id={m.cardId} src={m.image} name={m.name} setName={m.setName} alt={m.name} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium group-hover:text-accent">{m.name}</span>
                <span className="block truncate text-xs text-muted">{variantLabel(m.variant)}</span>
              </span>
              <MoverDelta changeUsd={m.changeUsd} changePct={m.changePct} money={money} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoverDelta({ changeUsd, changePct, money }: { changeUsd: number; changePct: number; money: (n: number) => string }) {
  const up = changeUsd > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 font-mono text-xs font-medium tabular ${up ? 'text-gain' : 'text-loss'}`}>
      <Icon size={13} />
      {up ? '+' : '−'}
      {money(Math.abs(changeUsd))} ({Math.abs(changePct).toFixed(1)}%)
    </span>
  );
}
