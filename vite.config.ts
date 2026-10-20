/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

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

/**
 * Só em dev no navegador: roda o SimulationCraft de WIPE_DEV_SIMC_EXE em POST /__simc
 * ({ input, log }), como o comando simc_run do app. Para testar o "comparar com o robô" sem o Tauri.
 */
function devSimc(): Plugin {
  const exe = process.env.WIPE_DEV_SIMC_EXE;
  return {
    name: 'dev-simc',
    apply: 'serve',
    configureServer(server) {
      if (!exe) return;
      server.middlewares.use('/__simc', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { input, log } = JSON.parse(body || '{}') as { input?: string; log?: boolean };
          const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wipe-dev-simc-'));
          fs.writeFileSync(path.join(work, 'input.simc'), input ?? '');
          const args = ['input.simc', 'json2=out.json', `threads=${Math.max(1, os.cpus().length - 1)}`, ...(log ? ['log=1', 'output=log.txt'] : [])];
          const started = Date.now();
          execFile(exe, args, { cwd: work, maxBuffer: 64 << 20 }, (err, stdout) => {
            res.setHeader('Content-Type', 'application/json');
            const out = path.join(work, 'out.json');
            if (err || !fs.existsSync(out)) {
              res.statusCode = 500;
              return res.end(JSON.stringify(String(stdout).split('\n').slice(-12).join('\n') || String(err)));
            }
            const result = {
              json: JSON.parse(fs.readFileSync(out, 'utf8')),
              log: log ? fs.readFileSync(path.join(work, 'log.txt'), 'utf8') : null,
              commit: 'dev',
              banner: `SimulationCraft (dev: ${exe})`,
              seconds: (Date.now() - started) / 1000,
            };
            fs.rmSync(work, { recursive: true, force: true });
            res.end(JSON.stringify(result));
          });
        });
      });
    },
  };
}

// Porta fixa: o Tauri aponta o devUrl para ela (src-tauri/tauri.conf.json).
// `--mode web` (npm run dev:web / build:web) é o site: .env.web liga o VITE_TARGET, o build sai
// em dist-web com o caminho do GitHub Pages, e o núcleo em WASM vem de src/web/pkg (npm run wasm).
export default defineConfig(({ mode, command, isPreview }) => ({
  plugins: [react(), devVideos(), devSimc()],
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
