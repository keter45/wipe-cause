/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Só em dev no navegador: serve vídeos do Warcraft Recorder de WIPE_DEV_VIDEO_DIR em
 * /__video?path=..., com Range (para o <video> conseguir pular). No app o Tauri usa o
 * protocolo asset.
 */
function devVideos(): Plugin {
  const root = process.env.WIPE_DEV_VIDEO_DIR;
  return {
    name: 'dev-videos',
    apply: 'serve',
    configureServer(server) {
      if (!root) return;
      server.middlewares.use('/__video', (req, res) => {
        const file = path.resolve(new URL(req.url ?? '', 'http://x').searchParams.get('path') ?? '');
        if (!file.toLowerCase().startsWith(path.resolve(root).toLowerCase()) || !fs.existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        const size = fs.statSync(file).size;
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        const start = m?.[1] ? Number(m[1]) : 0;
        const end = m?.[2] ? Number(m[2]) : size - 1;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        if (m) {
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

// Porta fixa: o Tauri aponta o devUrl para ela (src-tauri/tauri.conf.json).
// `--mode web` (npm run dev:web / build:web) é o site: .env.web liga o VITE_TARGET, o build sai
// em dist-web com o caminho do GitHub Pages, e o núcleo em WASM vem de src/web/pkg (npm run wasm).
export default defineConfig(({ mode, command, isPreview }) => ({
  plugins: [react(), devVideos()],
  clearScreen: false,
  // versão mostrada no site (no app vem do Tauri)
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync('package.json', 'utf8')).version) },
  base: mode === 'web' && (command === 'build' || isPreview) ? (process.env.WEB_BASE ?? '/wipe-cause/') : '/',
  resolve: { alias: [{ find: /^wipe-wasm\//, replacement: `${path.resolve(import.meta.dirname, 'src/web/pkg')}/` }] },
  worker: { format: 'es' },
  build: mode === 'web' ? { outDir: 'dist-web' } : undefined,
  // testes em português, como os textos esperados nos asserts (o inglês tem os próprios testes)
  test: { setupFiles: ['src/i18n/test-setup.ts'] },
  server: {
    port: mode === 'web' ? 1430 : 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] },
  },
}));
