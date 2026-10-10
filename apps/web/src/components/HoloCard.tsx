import { useRef, useState } from 'react';
import CardImage from './CardImage';

/** Large card image with pointer-driven 3D tilt and foil sheen. */
interface Props {
  id: string;
  src: string;
  name: string;
  number?: string;
  setName?: string;
  types?: string[];
  foil?: boolean;
}

export default function HoloCard({ id, src, name, number, setName, types, foil = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const raf = useRef(0);

  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty('--rx', `${(0.5 - y) * 18}deg`);
      el.style.setProperty('--ry', `${(x - 0.5) * 22}deg`);
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
      el.style.setProperty('--bx', `${50 + (x - 0.5) * 40}%`);
      el.style.setProperty('--by', `${50 + (y - 0.5) * 40}%`);
      el.style.setProperty('--foil-o', foil ? '1' : '0.5');
      el.style.transition = 'transform 0.08s linear';
    });
  };

  const leave = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    el.style.transition = 'transform 0.7s cubic-bezier(.2,.8,.2,1)';
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--foil-o', '0');
  };

  return (
    <div className="[perspective:1200px]">
      <div
        ref={ref}
        onPointerMove={move}
        onPointerLeave={leave}
        className="relative aspect-[63/88] w-full touch-pan-y overflow-hidden rounded-[4.5%/3.2%] bg-surface-2 shadow-object [transform-style:preserve-3d] [transform:rotateX(var(--rx,0))_rotateY(var(--ry,0))]"
      >
        {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
        <CardImage
          id={id}
          src={src}
          name={name}
          number={number}
          setName={setName}
          types={types}
          alt={name}
          hires
          loading="eager"
          onLoad={() => setLoaded(true)}
          className={`transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
        <div className="foil" />
        <div className="glare" />
      </div>
    </div>
  );
}
