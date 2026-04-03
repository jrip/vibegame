import { defineConfig } from 'vite';
import { vibegame, consoleForwarding } from 'vibegame/vite';

/** Локально: '/'. GitHub Pages (project site): VITE_BASE=/repo-name/ */
function publicBase(): string {
  const raw = process.env.VITE_BASE;
  if (!raw || raw === '/') return '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export default defineConfig({
  base: publicBase(),
  plugins: [vibegame(), consoleForwarding()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
