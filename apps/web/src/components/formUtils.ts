import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';

export const errorText = (err: unknown) =>
  err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong. Try again.';

/**
 * Wraps a form's submit handler with busy state and error display.
 * `run` should throw to show an error; its message is shown verbatim (server messages are user-facing).
 */
export function useSubmit(run: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      if (mounted.current) setError(errorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, setError, onSubmit };
}
