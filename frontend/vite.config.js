import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app lives under /app/. Everything else is the static site in site/.
// Keep these in sync with nginx/default.conf.template.
const APP_BASE = '/app/';
const SITE_DIR = path.resolve(import.meta.dirname, 'site');
// Old app URLs (from before the /app/ move) that redirect into the app.
const LEGACY_APP_PATHS = /^\/(?:login|register|account|admin|boards|notes|office|b)(?:\/|$)/;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// Dev only: serve site/ at / and the legacy redirects, the same way nginx does in production.
function staticSite() {
  return {
    name: 'kanforge-static-site',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const p = decodeURIComponent(url.pathname);
        if (p.startsWith(APP_BASE) || p.startsWith('/api/')) return next();

        const redirect = (to) => { res.statusCode = 302; res.setHeader('Location', to); res.end(); };
        if (p === '/app') return redirect(APP_BASE + url.search);
        if (LEGACY_APP_PATHS.test(p)) return redirect(`/app${p}${url.search}`);

        const candidates = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
        for (const c of candidates) {
          const file = path.join(SITE_DIR, path.normalize(c));
          if (!file.startsWith(SITE_DIR + path.sep)) break;
          try {
            const body = await readFile(file);
            res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
            return res.end(body);
          } catch { /* try the next candidate */ }
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html');
        res.end(await readFile(path.join(SITE_DIR, '404.html')));
      });
    },
  };
}

export default defineConfig({
  base: APP_BASE,
  plugins: [react(), staticSite()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: false },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: true,
  },
});
