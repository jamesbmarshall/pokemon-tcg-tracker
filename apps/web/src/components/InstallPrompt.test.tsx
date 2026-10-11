import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallPrompt from './InstallPrompt';

/** A minimal stand-in for the real (non-standard) BeforeInstallPromptEvent. */
function installPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('InstallPrompt', () => {
  it('renders nothing when the browser never offers to install', () => {
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an install button once beforeinstallprompt fires, and calls prompt() on click', async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const event = installPromptEvent();
    window.dispatchEvent(event);

    const button = await screen.findByRole('button', { name: 'Install PokéTracker as an app' });
    await user.click(button);
    expect(event.prompt).toHaveBeenCalled();
    expect(await screen.findByText('Installed')).toBeInTheDocument();
  });

  it('switches to the installed state after appinstalled fires', async () => {
    render(<InstallPrompt />);
    window.dispatchEvent(installPromptEvent());
    expect(await screen.findByRole('button', { name: 'Install PokéTracker as an app' })).toBeInTheDocument();

    window.dispatchEvent(new Event('appinstalled'));
    expect(await screen.findByText('Installed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install PokéTracker as an app' })).not.toBeInTheDocument();
  });
});
