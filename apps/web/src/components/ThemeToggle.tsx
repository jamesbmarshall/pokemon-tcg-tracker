import { Monitor, Moon, Sun } from 'lucide-react';
import { useSettings, type ThemePref } from '../store/settingsStore';

const ORDER: ThemePref[] = ['system', 'light', 'dark'];
const META: Record<ThemePref, { label: string; icon: typeof Sun }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

/** One-tap theme switch for the app chrome: cycles System → Light → Dark. Settings has the full choice. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = META[theme].icon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${META[theme].label}. Switch to ${META[next].label}`}
      title={`Theme: ${META[theme].label}`}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg ${className}`}
    >
      <Icon size={17} />
    </button>
  );
}
