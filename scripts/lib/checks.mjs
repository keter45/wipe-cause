// Peças comuns dos scripts de conferência por boss (sim-check, replay-check): ler o relatório da
// análise (o log passa pelo wipe-cli, com cache), escolher o boss e gravar o relatório.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROOT = path.join(import.meta.dirname, '..', '..');
export const WIPE_CLI = path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'wipe-cli.exe' : 'wipe-cli');

/** `--nome valor` e o primeiro argumento solto (o log ou o relatório). */
export function cliArgs(argv = process.argv.slice(2)) {
  const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
  const input = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  return { opt, input };
}

/** Roda o wipe-cli (release) e devolve a saída. */
export function wipeCli(args) {
  if (!fs.existsSync(WIPE_CLI)) throw new Error('wipe-cli não encontrado: cargo build --release -p wipe-core --bin wipe-cli');
  const r = spawnSync(WIPE_CLI, args, { maxBuffer: 2 ** 31 - 1, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'wipe-cli falhou');
  return r.stdout;
}

/**
 * O relatório da análise: o JSON dado, ou o log analisado agora pelo wipe-cli com o corte de N
 * mortes (cache em `cacheDir`, refeito quando o log ou o wipe-cli mudam).
 */
export function loadReport(input, cutoff, cacheDir) {
  if (input.endsWith('.json')) return JSON.parse(fs.readFileSync(input, 'utf8'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${path.basename(input, path.extname(input))}-cut${cutoff}.json`);
  const fresh = fs.existsSync(cached) && fs.existsSync(WIPE_CLI) && fs.statSync(cached).mtimeMs > Math.max(fs.statSync(input).mtimeMs, fs.statSync(WIPE_CLI).mtimeMs);
  if (!fresh) {
    console.log(`analisando ${path.basename(input)}…`);
    fs.writeFileSync(cached, wipeCli(['analyze', input, '--json', '--cutoff', String(cutoff)]));
  }
  return JSON.parse(fs.readFileSync(cached, 'utf8'));
}

/** Os pulls do boss pedido (sem pedido: o boss + dificuldade com mais pulls no log). */
export function bossPulls(pulls, boss, difficulty) {
  const groups = new Map();
  for (const p of pulls) {
    if (boss && p.encounterName !== boss) continue;
    if (difficulty && p.difficultyName !== difficulty) continue;
    const k = `${p.encounterName} · ${p.difficultyName}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const list = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!list?.length) throw new Error('nenhum pull desse boss no relatório');
  const ref = list[0];
  return { pulls: list, ref, title: `${ref.encounterName} ${ref.difficultyName}`, night: (ref.startLocal ?? '').split(' ')[0] || new Date(ref.startMs).toISOString().slice(0, 10) };
}

/** Grava `<pasta>/<data de hoje>-<boss>.md` (e .json) e devolve o caminho sem extensão. */
export function writeReport(dir, title, md, json) {
  fs.mkdirSync(dir, { recursive: true });
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${slug}`);
  fs.writeFileSync(`${file}.md`, md);
  fs.writeFileSync(`${file}.json`, JSON.stringify(json, null, 2));
  return path.relative(ROOT, file);
}

export const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
