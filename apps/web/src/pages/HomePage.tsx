import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Layers, MousePointerClick, Sparkles, WandSparkles } from 'lucide-react';
import { useSets } from '../api/hooks';
import { useCollectionStore } from '../store/collectionStore';
import { useCollectionStats } from '../hooks/useCollectionStats';
import { useMoney } from '../hooks/useMoney';
import ValueChart from '../components/ValueChart';
import { SetLogo, SetSymbol } from '../components/SetArt';
import CardImage from '../components/CardImage';
import { ProgressBar, ProgressRing, Segmented, Skeleton } from '../components/ui';
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
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular ${up ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
      <Icon size={13} />
      {up ? '+' : '−'}
      {money(Math.abs(diff))} ({Math.abs(p).toFixed(1)}%)
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Welcome() {
  const { data: sets, isLoading } = useSets();
  const latest = sets?.slice(0, 3) ?? [];
  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-8 sm:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[conic-gradient(from_90deg,#ffd23f55,#ff8ad855,#7ad7ff55,#b9ff8a55,#ffd23f55)] blur-3xl" />
        <p className="eyebrow">Your binder, minus the binder</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-tight font-stretch-expanded sm:text-6xl">
          Every card you own, <span className="holo-text">every one you don't.</span>
        </h1>
        <p className="mt-5 max-w-xl text-muted">
          Tick off sets as you open packs, chase master sets down to the last reverse holo, and watch what it's all worth. Everything stays on this device.
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
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: MousePointerClick, title: 'Tap to collect', body: 'Each card shows its printings — N, RH, H. Tap one to add it. Right-click to take one away.' },
          { icon: Layers, title: 'Master set mode', body: 'Track base, full and master completion separately, so secret rares and reverse holos count properly.' },
          { icon: BookOpen, title: 'Binder pages', body: 'Flip through a virtual 9-pocket binder, with empty pockets showing exactly what is missing.' },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="panel p-5">
            <Icon size={20} className="text-volt" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-4 font-display text-xl font-semibold">Latest releases</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36" />)}
          {latest.map((s) => (
            <Link key={s.id} to={`/sets/${s.id}`} className="panel group flex h-36 flex-col justify-between p-5 transition-colors hover:border-line-strong">
              <SetLogo src={s.images.logo} name={s.name} className="h-12 w-auto self-start object-contain transition-transform group-hover:scale-105" fallbackClassName="text-xl" />
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted">{formatDate(s.releaseDate)} · {s.total} cards</p>
                </div>
                <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-volt" />
              </div>
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
  const cards = useCollectionStore((s) => s.cards);
  const stats = useCollectionStats();
  const money = useMoney();
  const { data: allSets } = useSets();
  const [chart, setChart] = useViewPref<'value' | 'gain'>('home.chart', 'value', ['value', 'gain']);

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

  if (!isLoaded) return <Skeleton className="h-80" />;
  if (stats.count === 0) return <Welcome />;

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-[conic-gradient(from_0deg,#ffd23f33,#ff8ad833,#7ad7ff33,#ffd23f33)] blur-3xl" />
          <p className="eyebrow">Collection value</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <p className="font-display text-5xl font-extrabold tracking-tight tabular font-stretch-expanded sm:text-6xl">{money(stats.valueUsd)}</p>
            <Delta now={stats.valueUsd} then={then} money={(n) => money(n)} />
          </div>
          <p className="mt-1 text-xs text-muted">Market prices, converted at today's rate</p>
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
            <ValueChart points={history} format={(n) => money(n)} height={150} metric={stats.cost.costed > 0 ? chart : 'value'} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
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
          <Link to="/wishlist" className="panel p-4 transition-colors hover:border-line-strong">
            <p className="eyebrow">Wishlist</p>
            <p className="mt-2 font-display text-2xl font-bold tabular">{wishlist.size}</p>
            <p className="mt-0.5 text-xs text-muted">{wishlist.size ? `≈ ${money(wishCost, { compact: true })} to buy` : 'Nothing yet'}</p>
          </Link>
        </div>
      </section>

      {/* Sets in progress */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-semibold">Sets in progress</h2>
          <Link to="/sets?filter=started" className="text-sm text-muted hover:text-volt">
            All sets →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {inProgress.map((s) => (
            <Link key={s.setId} to={`/sets/${s.setId}`} className="panel group flex items-center gap-4 p-4 transition-colors hover:border-line-strong">
              <ProgressRing value={s.baseOwned} total={s.printedTotal} size={58} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {setLogo.get(s.setId) && <SetSymbol src={setLogo.get(s.setId)!.symbol} className="h-4 w-4 object-contain" />}
                  <p className="truncate font-medium">{s.setName}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted tabular">
                  {s.baseOwned}/{s.printedTotal} base
                  {s.uniqueOwned > s.baseOwned && ` + ${s.uniqueOwned - s.baseOwned} secret`}
                  {s.p >= 100 ? ' · complete ✦' : ` · ${s.printedTotal - s.baseOwned} to go`}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-faint">{money(s.valueUsd, { compact: true })}</p>
              </div>
              <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-volt" />
            </Link>
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:gap-12">
        <Strip title="Most valuable" icon={<Sparkles size={16} className="text-volt" />} link="/collection?sort=value">
          {top.map((o) => (
            <MiniCard key={o.card.id} o={o} line={money(o.topPrice)} />
          ))}
        </Strip>
        <Strip title="Recently added" icon={<WandSparkles size={16} className="text-volt" />} link="/collection?sort=added">
          {recent.map((o) => (
            <MiniCard key={o.card.id} o={o} line={relativeTime(o.addedAt)} sub={o.entries[0] ? variantLabel(o.entries[0].variant) : formatGrade(o.graded[0])} />
          ))}
        </Strip>
      </section>

      {inProgress.length > 0 && (
        <section className="panel p-5">
          <p className="eyebrow mb-3">Closest to complete</p>
          {inProgress.filter((s) => s.p < 100).slice(0, 3).map((s) => (
            <div key={s.setId} className="flex items-center gap-4 py-2">
              <span className="w-40 truncate text-sm">{s.setName}</span>
              <ProgressBar value={s.baseOwned} total={s.printedTotal} />
              <span className="w-14 text-right font-mono text-xs text-muted tabular">{Math.floor(s.p)}%</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Strip({ title, icon, link, children }: { title: string; icon: React.ReactNode; link: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          {icon}
          {title}
        </h2>
        <Link to={link} className="text-sm text-muted hover:text-volt">
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
      <div className="aspect-[63/88] overflow-hidden rounded-[4.5%/3.2%] ring-1 ring-line transition-transform duration-300 group-hover:-translate-y-1">
        <CardImage id={o.card.id} src={o.card.image} name={o.card.name} setName={o.card.setName} types={o.card.types} alt={o.card.name} />
      </div>
      <p className="mt-2 truncate text-xs font-medium">{o.card.name}</p>
      <p className="truncate font-mono text-[10.5px] text-muted">{line}</p>
      {sub && <p className="truncate text-[10px] text-faint">{sub}</p>}
    </Link>
  );
}
