/** Display formatting for dates, percentages, byte sizes and user agents. Dates are shown in en-GB style. */
export function formatDate(iso: string) {
  // TCGdex release dates use slashes (2023/09/22), which not every browser parses.
  const d = new Date(iso.replace(/\//g, '-'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function year(iso: string) {
  return iso.slice(0, 4);
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

/** Percentage for progress bars, capped at 100 and returning 0 for an empty total instead of NaN. */
export function pct(n: number, d: number) {
  return d > 0 ? Math.min(100, (n / d) * 100) : 0;
}

/** Today's date as YYYY-MM-DD in the user's local time zone (not UTC), so it matches the user's calendar. */
export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Chrome on macOS" from a user-agent string; good enough to recognise your own devices. */
export function describeAgent(ua: string) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Time until a future moment, for scheduled jobs. Anything in the past reads as "due now". */
export function fromNow(iso: string) {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 0) return 'due now';
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}
