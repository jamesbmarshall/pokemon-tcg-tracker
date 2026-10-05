import { describe, expect, it, vi } from 'vitest';
import { formatDate, pct, relativeTime, todayKey, year } from './format';

describe('format utils', () => {
  it('pct clamps and guards', () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(5, 4)).toBe(100);
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, -3)).toBe(0);
  });
  it('todayKey is a YYYY-MM-DD string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-04T10:00:00Z'));
    expect(todayKey()).toBe('2025-03-04');
  });
  it('formatDate', () => {
    expect(formatDate('2023/09/22')).toMatch(/2023/);
    expect(formatDate('not a date')).toBe('not a date');
    expect(year('2023-09-22')).toBe('2023');
  });
  it('relativeTime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-04T12:00:00Z'));
    expect(relativeTime('2025-03-04T11:59:50Z')).toMatch(/just now/i);
  });
});

describe('relativeTime steps', () => {
  const now = new Date('2025-03-04T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it.each([
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [4 * 86_400_000, '4d ago'],
  ])('%i ms ago → %s', (ms, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime(ago(ms))).toBe(expected);
  });
  it('falls back to a formatted date after 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(relativeTime('2024-12-25T12:00:00Z')).toBe(formatDate('2024-12-25T12:00:00Z'));
    expect(formatDate('2024-12-25')).toBe('25 Dec 2024');
  });
});
