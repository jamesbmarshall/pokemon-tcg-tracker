/**
 * "Install app" section for Settings. Renders nothing at all — not even its heading — unless
 * `beforeinstallprompt` has fired (so there is something to do) or the app is already installed
 * (so there is something to confirm); an unsupported browser such as Safari gets neither event
 * and the section simply doesn't exist for it.
 */
import { Check, Download } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

export default function InstallPrompt() {
  const { canInstall, installed, install } = useInstallPrompt();

  if (!canInstall && !installed) return null;

  return (
    <section className="grid gap-4 border-b border-line py-8 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="font-semibold">Install app</h2>
        <p className="mt-1 text-sm text-muted">Add PokéTracker to your home screen or app list, with offline access to the app shell.</p>
      </div>
      <div>
        {installed ? (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Check size={15} className="text-gain" /> Installed
          </p>
        ) : (
          <button onClick={() => void install()} className="btn btn-primary" aria-label="Install PokéTracker as an app">
            <Download size={15} /> Install app
          </button>
        )}
      </div>
    </section>
  );
}
