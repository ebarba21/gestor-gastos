/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Ruta base de publicacion. En local y en hostings en la raiz del dominio es '/'. En GitHub
// Pages (https://<usuario>.github.io/<repo>/) el workflow de despliegue fija VITE_BASE_PATH a
// '/<repo>/'. Se normaliza para que siempre empiece y termine en '/'.
function resolveBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

const base = resolveBasePath(process.env.VITE_BASE_PATH);

// Configuracion de Vite para la PWA local-first.
// Invariante: sin runtime caching de dominios externos. El service worker solo
// precachea los assets propios de la app (JS, CSS, HTML, iconos, manifest).
export default defineConfig({
  base,
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
        description: 'Gestor de gastos personales local-first, con sincronizacion privada opcional.',
        lang: 'es',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        // Tanto start_url como scope siguen la ruta base: asi la app instalada en iPhone o PC
        // abre siempre dentro de su propio ambito, tambien publicada en una subruta.
        start_url: base,
        scope: base,
        id: base,
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
        navigateFallback: `${base}index.html`,
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
