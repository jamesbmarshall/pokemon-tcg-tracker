import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setBackend } from '../api/backend';
import { resetMemoryBackend } from './memoryBackend';

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function installBrowserStubs() {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock';
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  if (!globalThis.CSS?.escape) vi.stubGlobal('CSS', { ...(globalThis.CSS ?? {}), escape: (s: string) => s });
}

installBrowserStubs();

beforeEach(() => {
  installBrowserStubs();
  setBackend(resetMemoryBackend());
  // Default network: fail loudly so tests that forget to mock fetch don't hit the real API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unmocked fetch: ${String(input)}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
