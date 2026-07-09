/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Configuracion de Vite para la PWA local-first.
// Invariante: sin runtime caching de dominios externos. El service worker solo
// precachea los assets propios de la app (JS, CSS, HTML, iconos, manifest).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Sin autorefresh silencioso: la actualizacion se ofrece al usuario (fase 7).
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gestor de Gastos',
        short_name: 'Gastos',
        description: 'Gestor de gastos personales local-first. Coste 0.',
        lang: 'es',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // PNG generados con scripts/generate-icons.mjs (mismo diseno que icon.svg).
        // Se separan purpose any y maskable: combinarlos degrada el render en Android.
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache de assets propios unicamente. Fallback de navegacion a index.html (SPA).
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // No se registran runtimeCaching handlers: no se piden recursos de terceros.
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
