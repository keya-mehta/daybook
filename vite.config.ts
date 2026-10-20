import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',                        // the page source; built files go to dist/
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
  base: process.env.BASE_PATH || '/',   // GitHub Pages serves the app from /daybook/
  resolve: { alias: { '@engine': fileURLToPath(new URL('./supabase/functions/_shared/engine', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest', srcDir: '../src', filename: 'sw.ts', registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
      manifest: {
        name: 'Daybook — family planner', short_name: 'Daybook', start_url: '.', scope: '.', display: 'standalone',
        background_color: '#f7f5f0', theme_color: '#f7f5f0', orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
