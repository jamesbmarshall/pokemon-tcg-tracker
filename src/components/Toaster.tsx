import { Check, X } from 'lucide-react';
import { useToasts } from '../store/toastStore';

export default function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex animate-rise items-center gap-3 rounded-2xl border border-line-strong bg-surface-2/95 py-2 pl-4 pr-2 text-sm shadow-2xl backdrop-blur"
        >
          {t.tone === 'success' && <Check size={16} className="text-gain" />}
          {t.tone === 'error' && <X size={16} className="text-loss" />}
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="rounded-lg bg-volt px-2.5 py-1 text-xs font-bold text-ink"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-lg p-1 text-faint hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
