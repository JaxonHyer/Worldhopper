import { defineConfig } from 'vite';

/**
 * `base: './'` so one build works from the repo root, a subfolder, and GitHub
 * Pages (AGENT_PROMPT.md §3). Everything is self-hosted: no CDN, no fonts, no
 * analytics, no runtime network requests.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5173,
    // The sandbox preview proxies through *.e2b.app; without this Vite answers
    // "Blocked request" for that host.
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
});
