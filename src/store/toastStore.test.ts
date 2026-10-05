import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, useToasts } from './toastStore';

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

describe('toast store', () => {
  it('pushes toasts with unique ids and keeps only the last three', () => {
    for (const m of ['a', 'b', 'c', 'd']) toast(m);
    const { toasts } = useToasts.getState();
    expect(toasts.map((t) => t.message)).toEqual(['b', 'c', 'd']);
    expect(new Set(toasts.map((t) => t.id)).size).toBe(3);
  });

  it('passes tone and action through', () => {
    const run = vi.fn();
    toast('Removed', { tone: 'success', action: { label: 'Undo', run } });
    expect(useToasts.getState().toasts[0]).toMatchObject({ message: 'Removed', tone: 'success', action: { label: 'Undo' } });
  });

  it('auto-dismisses after 3.2s, or 6s when there is an action', () => {
    toast('plain');
    toast('undoable', { action: { label: 'Undo', run: () => {} } });
    vi.advanceTimersByTime(3200);
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['undoable']);
    vi.advanceTimersByTime(2800);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('dismisses by id', () => {
    toast('x');
    const [{ id }] = useToasts.getState().toasts;
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
