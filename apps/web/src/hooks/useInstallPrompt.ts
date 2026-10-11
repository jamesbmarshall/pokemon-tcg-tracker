/**
 * Tracks the browser's `beforeinstallprompt` event so Settings can offer an "Install app"
 * button. The event only fires when the browser thinks the app is installable (not already
 * installed, meets its own PWA criteria) and must be captured once and replayed later, since
 * calling `.prompt()` outside the original event handler needs the saved event object.
 */
import { useEffect, useState } from 'react';

/** Not yet in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Stop the browser's own mini-infobar; we show our own button instead.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The prompt can only be used once; drop it either way so the button disappears.
    setDeferred(null);
    if (outcome === 'accepted') setInstalled(true);
  };

  return { canInstall: !!deferred, installed, install };
}
