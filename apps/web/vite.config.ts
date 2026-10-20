/// <reference types="vitest/config" />
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { copyFileSync, createReadStream, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'

// Resolved via require.resolve rather than a relative node_modules path: in this npm workspaces
// monorepo these packages are hoisted to the repo root, not apps/web/node_modules.
const require = createRequire(import.meta.url)
const tesseractDist = dirname(require.resolve('tesseract.js/dist/worker.min.js'))
const tesseractCoreDir = dirname(require.resolve('tesseract.js-core/package.json'))
const engLangDir = dirname(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'))

// Exact asset map: no glob watcher or arbitrary filesystem path is exposed in development.
function selfHostedOcr(): Plugin {
  const files = new Map<string, string>([
    ['/tesseract/worker.min.js', join(tesseractDist, 'worker.min.js')],
    ['/tesseract/lang/eng.traineddata.gz', join(engLangDir, 'eng.traineddata.gz')],
    ...['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm'].map(name => [`/tesseract/core/${name}`, join(tesseractCoreDir, name)] as [string, string]),
  ])
  let outDir = ''
  let building = false
  return {
    name: 'self-hosted-ocr',
    configResolved(config) { outDir = config.build.outDir; building = config.command === 'build' },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const source = files.get(url)
        if (!source) return next()
        res.setHeader('Content-Type', url.endsWith('.js') ? 'text/javascript' : url.endsWith('.wasm') ? 'application/wasm' : 'application/gzip')
        createReadStream(source).on('error', next).pipe(res)
      })
    },
    closeBundle() {
      if (!building) return
      for (const [url, source] of files) {
        const target = join(outDir, url.slice(1))
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(source, target)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Self-hosts the scan page's OCR assets (worker, wasm core, English traineddata) from
    // node_modules at build time, so nothing is ever fetched from a CDN (the CSP wouldn't allow
    // it anyway). Only the LSTM-only core variants are copied, matching tesseract.js's default
    // OEM, which is all the scan page asks for.
    selfHostedOcr(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a silent reload could drop in-progress edits. The user
      // confirms via the toast wired up in main.tsx (see onNeedRefresh there).
      registerType: 'prompt',
      // The dev server never registers a service worker; only production builds do.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'PokéTracker',
        short_name: 'PokéTracker',
        description: 'Track and manage your Pokémon TCG card collection.',
        // Manifests only support one theme/background colour pair; index.html's light value
        // (the dark one is applied at runtime by theme.js, which a manifest can't do).
        theme_color: '#f4f1ea',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // generateSW's default precache of the built app shell/static assets is left enabled.
        // The OCR assets are excluded: they're multi-megabyte, fetched on demand only by the
        // scan page (and then runtime-cached below), not part of the app shell every visit needs.
        globIgnores: ['tesseract/**/*'],
        runtimeCaching: [
          // The scan page's self-hosted OCR assets rarely change and are large, so once fetched
          // they're kept rather than re-downloaded on every visit to /scan.
          {
            urlPattern: /\/tesseract\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 20, maxAgeSeconds: 180 * 24 * 3600 } },
          },
          // Card images go through the server's own proxy; cache them but keep them fresh.
          {
            urlPattern: /\/api\/img(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'card-images',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          // /health is polled by the updater and must always hit the network.
          { urlPattern: /\/health$/, handler: 'NetworkOnly' },
          // Everything else under /api/* is per-user, often-sensitive JSON: never served from
          // cache, even offline. This is listed after the /api/img rule above so that carve-out
          // wins first.
          { urlPattern: /\/api\/.*/, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**', 'src/**/*.test.{ts,tsx}', 'src/api/legacySets.ts', 'src/vite-env.d.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
})
