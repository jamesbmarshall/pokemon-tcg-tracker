/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        runtimeCaching: [
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
