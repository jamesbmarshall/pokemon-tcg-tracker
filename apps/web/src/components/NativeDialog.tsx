import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const dialogs: HTMLDialogElement[] = [];
let priorOverflow = '';

/** One native modal primitive: top-layer rendering makes background content inert and
 * delegates Tab containment to the browser. Nested dialogs retain their own focus origin.
 */
export default function NativeDialog({ children, onClose, label, labelledBy, initialFocus, className = '', dark = false }: {
  children: ReactNode; onClose: () => void; label?: string; labelledBy?: string;
  initialFocus?: RefObject<HTMLElement | null>; className?: string; dark?: boolean;
}) {
  const element = useRef<HTMLDialogElement>(null);
  const origin = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const dialog = element.current!;
    if (!dialogs.length) { priorOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogs.push(dialog);
    dialog.showModal();
    (initialFocus?.current ?? dialog.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? dialog.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])') ?? dialog.querySelector<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]') ?? dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && dialogs.at(-1) === dialog) {
        const focusable = [...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(el => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getClientRects().length);
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        if (!focusable.length) { event.preventDefault(); dialog.focus(); }
        else { event.preventDefault(); focusable[(at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus(); }
      }
      if (event.key === 'Escape' && dialogs.at(-1) === dialog) { event.preventDefault(); close.current(); }
    };
    window.addEventListener('keydown', key);
    const previous = origin.current;
    return () => {
      window.removeEventListener('keydown', key);
      dialog.close();
      const index = dialogs.indexOf(dialog); if (index !== -1) dialogs.splice(index, 1);
      if (!dialogs.length) document.body.style.overflow = priorOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [initialFocus]);
  return createPortal(<dialog ref={element} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1}
    className={`fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-fg open:flex items-center justify-center ${dark ? 'backdrop:bg-black/90' : 'backdrop:bg-onyx/45'} ${className}`}
    onCancel={(event) => { event.preventDefault(); close.current(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) close.current(); }}>
    {children}
  </dialog>, document.body);
}
