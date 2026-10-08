import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanPage from './ScanPage';
import Toaster from '../components/Toaster';
import { renderWithProviders } from '../test/render';
import { resetStores, seedCollection } from '../test/ui-helpers';
import { makeSnapshot } from '../test/fixtures';
import { useCollectionStore } from '../store/collectionStore';

const mocks = vi.hoisted(() => ({ lookupScan: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, lookupScan: mocks.lookupScan };
});

// tesseract.js is only ever dynamically imported by the scan page itself; stub it out so no real
// worker, wasm or CDN asset is ever touched in tests.
const worker = { recognize: vi.fn(), terminate: vi.fn() };
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => worker),
  OEM: { LSTM_ONLY: 2 },
}));

const qty = (id: string) => useCollectionStore.getState().byCard.get(id);

function stubSecureCamera(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
}

// A fake track/stream good enough for the page's start/stop lifecycle and HTMLVideoElement.play(),
// which jsdom doesn't implement.
function fakeStream() {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }], __stop: stop } as unknown as MediaStream & { __stop: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetStores();
  seedCollection();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  // jsdom never actually decodes video, so the page's readiness/size checks need faking too.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, value: 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, value: 480 });
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ drawImage: vi.fn() }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  worker.recognize.mockResolvedValue({ data: { text: '' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScanPage', () => {
  it('explains that camera scanning needs HTTPS when the context is insecure', async () => {
    renderWithProviders(<ScanPage />);
    expect(await screen.findByText(/secure \(HTTPS\) connection/)).toBeInTheDocument();
  });

  it("tells the user their browser doesn't support camera scanning", async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderWithProviders(<ScanPage />);
    expect(await screen.findByText(/doesn't support camera scanning/)).toBeInTheDocument();
  });

  it('shows a clear message when camera permission is denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new DOMException('no', 'NotAllowedError')));
    stubSecureCamera(getUserMedia);
    renderWithProviders(<ScanPage />);
    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument();
  });

  it('scans a frame, finds one match, adds a copy, and offers undo', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubSecureCamera(getUserMedia);
    const card = makeSnapshot();
    mocks.lookupScan.mockResolvedValue([card]);
    worker.recognize.mockResolvedValue({ data: { text: 'SVI 001/198' } });

    renderWithProviders(
      <>
        <ScanPage />
        <Toaster />
      </>,
    );

    expect(await screen.findByText('Found a match', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charmander' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add Normal' }));
    await waitFor(() => expect(qty(card.id)).toEqual({ normal: 1 }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove one Normal' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(qty(card.id)).toEqual({ normal: 1 }));
  });

  it('offers a picker when several printings match, then confirms the chosen one', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    stubSecureCamera(getUserMedia);
    const a = makeSnapshot({ id: 'sv03-001', setName: 'Obsidian Flames' });
    const b = makeSnapshot({ id: 'swsh04-001', setName: 'Vivid Voltage' });
    mocks.lookupScan.mockResolvedValue([a, b]);
    worker.recognize.mockResolvedValue({ data: { text: '001/198' } });

    renderWithProviders(<ScanPage />);

    expect(await screen.findByText('Found 2 matching printings — pick one:', {}, { timeout: 5000 })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Use this printing' });
    await userEvent.click(buttons[0]);
    expect(screen.getByText('Found a match')).toBeInTheDocument();
  });

  it('looks a card up from the manual entry form without a camera', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined });
    const card = makeSnapshot();
    mocks.lookupScan.mockResolvedValue([card]);

    renderWithProviders(<ScanPage />);
    await userEvent.type(screen.getByLabelText('Set code (optional)'), 'SVI');
    await userEvent.type(screen.getByLabelText('Collector number'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Look up card' }));

    expect(await screen.findByText('Found a match')).toBeInTheDocument();
    expect(mocks.lookupScan).toHaveBeenCalledWith({ setCode: 'SVI', number: '1' });
  });

  it('shows an error when manual entry finds nothing', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined });
    mocks.lookupScan.mockResolvedValue([]);

    renderWithProviders(<ScanPage />);
    await userEvent.type(screen.getByLabelText('Collector number'), '999');
    await userEvent.click(screen.getByRole('button', { name: 'Look up card' }));

    expect(await screen.findByText(/No matching card found/)).toBeInTheDocument();
  });

  it('requires a collector number before looking anything up', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderWithProviders(<ScanPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up card' }));
    expect(await screen.findByText('Enter a collector number.')).toBeInTheDocument();
    expect(mocks.lookupScan).not.toHaveBeenCalled();
  });
});
