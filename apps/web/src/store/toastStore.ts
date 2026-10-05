/**
 * Global toast queue. A plain store rather than React context so non-component code (the
 * collection store's undo and error handling) can raise toasts.
 */
import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    // Keep at most three on screen; the oldest goes first.
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    // Toasts with an action (usually Undo) stay longer so there is time to use it.
    setTimeout(() => get().dismiss(id), t.action ? 6000 : 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, opts: Omit<Toast, 'id' | 'message'> = {}) =>
  useToasts.getState().push({ message, ...opts });
