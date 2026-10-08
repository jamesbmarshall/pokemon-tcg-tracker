/**
 * Camera-scan page: points the device camera at a card's bottom strip, reads the collector
 * number (and set/promo code where printed) with on-device OCR, and resolves it to a card via
 * GET /api/cards/lookup. Frames never leave the device — only the few characters the parser
 * extracts are sent to the server. A manual entry form works without a camera at all.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type Tesseract from 'tesseract.js';
import { Camera, CameraOff, LoaderCircle, RefreshCw, ScanLine, TriangleAlert } from 'lucide-react';
import { parseScanText } from '@poketracker/shared/scan';
import { lookupScan } from '../api/client';
import type { CardSnapshot } from '../api/types';
import CardTile from '../components/CardTile';
import { PageHeader } from '../components/ui';

type CameraState = 'checking' | 'requesting' | 'ready' | 'unsupported' | 'insecure' | 'denied' | 'error';
type OcrState = 'idle' | 'loading' | 'ready' | 'error';

// How much of the frame, as fractions of the video's own pixel size, is cropped for OCR: a strip
// across the bottom of the card, inset from the edges, where the collector number is printed.
// Kept in sync with the dashed guide box drawn over the video.
const GUIDE = { x: 0.1, y: 0.72, w: 0.8, h: 0.17 };
const RECOGNISE_INTERVAL_MS = 1200;

/** Self-hosted so no OCR asset is ever fetched from a CDN; copied from node_modules at build time. */
const TESSERACT_PATHS = { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/core', langPath: '/tesseract/lang' };

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Tesseract.Worker | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>('checking');
  const [ocrState, setOcrState] = useState<OcrState>('idle');
  const [match, setMatch] = useState<CardSnapshot[] | null>(null);

  const [manualSet, setManualSet] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Starts the camera on mount, and always stops its tracks again, whether the page is left or
  // the camera never started.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!window.isSecureContext) {
        setCameraState('insecure');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState('unsupported');
        return;
      }
      setCameraState('requesting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraState('ready');
      } catch (err) {
        if (cancelled) return;
        setCameraState(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    }
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Tesseract is only ever imported on this page, and only once the camera is actually in use.
  useEffect(() => {
    if (cameraState !== 'ready') return;
    let cancelled = false;
    async function loadWorker() {
      setOcrState('loading');
      try {
        const { createWorker, OEM } = await import('tesseract.js');
        const worker = await createWorker('eng', OEM.LSTM_ONLY, { ...TESSERACT_PATHS, gzip: true });
        if (cancelled) {
          void worker.terminate();
          return;
        }
        workerRef.current = worker;
        setOcrState('ready');
      } catch {
        if (!cancelled) setOcrState('error');
      }
    }
    void loadWorker();
    return () => {
      cancelled = true;
    };
  }, [cameraState]);

  // Terminates the worker once, whenever the page itself unmounts.
  useEffect(
    () => () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  /** Crops the guide-box region of the current frame onto a canvas and OCRs just that. */
  const recogniseFrame = useCallback(async (): Promise<string | null> => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || video.readyState < 2) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;
    const sx = Math.round(vw * GUIDE.x);
    const sy = Math.round(vh * GUIDE.y);
    const sw = Math.round(vw * GUIDE.w);
    const sh = Math.round(vh * GUIDE.h);
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const {
      data: { text },
    } = await worker.recognize(canvas);
    return text;
  }, []);

  // The scan loop: one recognise-then-lookup round at a time, never overlapping, paused while a
  // match is on screen so the camera isn't wasted recognising the same confirmed card again.
  useEffect(() => {
    if (cameraState !== 'ready' || ocrState !== 'ready' || match) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      try {
        const text = await recogniseFrame();
        const [best] = text ? parseScanText(text) : [];
        if (best) {
          const found = await lookupScan({ setCode: best.setCode, number: best.number, total: best.total }).catch(() => []);
          if (!cancelled && found.length) {
            setMatch(found);
            return;
          }
        }
      } catch {
        // A single misread or garbled frame shouldn't stop the camera scanning the next one.
      }
      if (!cancelled) timer = setTimeout(tick, RECOGNISE_INTERVAL_MS);
    };
    timer = setTimeout(tick, RECOGNISE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cameraState, ocrState, match, recogniseFrame]);

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    const number = manualNumber.trim();
    setManualError(null);
    if (!number) {
      setManualError('Enter a collector number.');
      return;
    }
    setManualLoading(true);
    try {
      const found = await lookupScan({ setCode: manualSet.trim() || undefined, number });
      if (!found.length) setManualError("No matching card found. Double-check the set code and number.");
      else setMatch(found);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Couldn't look that card up.");
    } finally {
      setManualLoading(false);
    }
  }

  const scanNext = () => {
    setMatch(null);
    setManualError(null);
  };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Camera" title="Scan a card">
        Point your camera at the bottom strip of a card — the collector number and set code — or type them in below.
      </PageHeader>

      {!match && (
        <section className="space-y-3">
          <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-xl bg-onyx">
            {cameraState === 'ready' || cameraState === 'requesting' ? (
              <>
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="Camera preview" />
                <div
                  className="pointer-events-none absolute rounded-md border-2 border-dashed border-paper/80"
                  style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}
                  aria-hidden
                />
                <p className="absolute inset-x-0 bottom-2 text-center text-xs text-paper/80">Align the number strip inside the box</p>
              </>
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-paper/80" role="status">
                {cameraState === 'checking' && (
                  <p className="flex items-center gap-2">
                    <LoaderCircle size={16} className="animate-spin" /> Starting the camera…
                  </p>
                )}
                {cameraState === 'unsupported' && (
                  <p className="flex flex-col items-center gap-2">
                    <CameraOff size={22} />
                    Your browser doesn't support camera scanning here. Use manual entry below instead.
                  </p>
                )}
                {cameraState === 'insecure' && (
                  <p className="flex flex-col items-center gap-2">
                    <TriangleAlert size={22} />
                    The camera needs a secure (HTTPS) connection. Use manual entry below, or open PokéTracker over HTTPS.
                  </p>
                )}
                {cameraState === 'denied' && (
                  <p className="flex flex-col items-center gap-2">
                    <CameraOff size={22} />
                    Camera access was denied. Allow it in your browser's site settings, or use manual entry below.
                  </p>
                )}
                {cameraState === 'error' && (
                  <p className="flex flex-col items-center gap-2">
                    <TriangleAlert size={22} />
                    Couldn't start the camera. Use manual entry below instead.
                  </p>
                )}
              </div>
            )}
          </div>
          {cameraState === 'ready' && ocrState !== 'ready' && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted" role="status">
              {ocrState === 'error' ? (
                <>
                  <TriangleAlert size={14} className="text-loss" /> OCR failed to load. Use manual entry below instead.
                </>
              ) : (
                <>
                  <LoaderCircle size={14} className="animate-spin" /> Loading text recognition…
                </>
              )}
            </p>
          )}
        </section>
      )}

      {match && match.length === 1 && (
        <section className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-gain">
            <Camera size={15} /> Found a match
          </p>
          <div className="max-w-[220px]">
            <CardTile card={match[0]} showSet quickAdd />
          </div>
          <button onClick={scanNext} className="btn btn-ghost">
            <RefreshCw size={15} /> Scan next card
          </button>
        </section>
      )}

      {match && match.length > 1 && (
        <section className="space-y-3">
          <p className="text-sm font-medium">Found {match.length} matching printings — pick one:</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {match.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <CardTile card={c} showSet />
                <button onClick={() => setMatch([c])} className="btn btn-ghost w-full text-xs">
                  Use this printing
                </button>
              </div>
            ))}
          </div>
          <button onClick={scanNext} className="btn btn-ghost">
            <RefreshCw size={15} /> Scan next card
          </button>
        </section>
      )}

      <section className="max-w-sm space-y-3 border-t border-line pt-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <ScanLine size={16} /> Manual entry
        </h2>
        <form onSubmit={(e) => void submitManual(e)} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Set code (optional)</span>
            <input value={manualSet} onChange={(e) => setManualSet(e.target.value)} placeholder="e.g. SVI" maxLength={8} className="input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Collector number</span>
            <input value={manualNumber} onChange={(e) => setManualNumber(e.target.value)} placeholder="e.g. 123" maxLength={10} className="input w-full" />
          </label>
          {manualError && <p className="text-sm text-loss">{manualError}</p>}
          <button type="submit" disabled={manualLoading} className="btn btn-primary w-full">
            {manualLoading ? <LoaderCircle size={15} className="animate-spin" /> : <ScanLine size={15} />}
            Look up card
          </button>
        </form>
      </section>
    </div>
  );
}
