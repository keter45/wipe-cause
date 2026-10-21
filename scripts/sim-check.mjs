// Confere a simulação (o robô do SimulationCraft) num boss: simula a raide toda como o app faz
// (o mesmo código de src/lib/simProfile.ts, empacotado na hora) e compara com o que cada um fez no
// pull. No fim, o modelo da luta que o robô jogou e um relatório OK / ATENÇÃO / REVISAR. Os itens
// REVISAR pedem mudança no modelo da luta: a skill sim-calibrate cuida deles.
//
//   npm run sim:check -- <WoWCombatLog.txt | relatório.json>              o boss com mais pulls no log
//   npm run sim:check -- <log> --boss "The Coiled Altar" --difficulty Mythic
//   npm run sim:check -- <log> --iterations 300                            mais rápido (padrão: 1000, como o app)
//   npm run sim:check -- <log> --cutoff 0                                  sem "ignorar após N mortes" (padrão: 4, como o app)
//
// O log é analisado pelo wipe-cli (target/release; `cargo build --release -p wipe-core --bin wipe-cli`).
// O SimC é o do app (<dados do app>/simc/simc.exe) ou WIPE_SIMC_EXE. O relatório fica em
// samples/sim/<data>-<boss>.md (e .json).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'rolldown';
import { ROOT, bossPulls, cliArgs, loadReport, mmss, writeReport } from './lib/checks.mjs';

const OUT = path.join(ROOT, 'samples', 'sim');
const CACHE = path.join(OUT, '.cache');
const { opt, input } = cliArgs();
const ITERATIONS = Number(opt('iterations', 1000));
/** "Ignorar eventos após N mortes": o padrão do app (src/lib/cutoff.ts), senão a janela não é a mesma. */
const CUTOFF = Number(opt('cutoff', 4));
const APP_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'gg.wipecause.app');
const simc = process.env.WIPE_SIMC_EXE ?? path.join(APP_DATA, 'simc', process.platform === 'win32' ? 'simc.exe' : 'simc');

// ---------------------------------------------------------------- limites do relatório

/** A mediana dos DPS fora desta faixa: o modelo da luta (movimento, alvos, vida) está errado. */
const RAID_MEDIAN = [0.85, 1.05];
/** Um DPS acima disso do robô: o robô está fraco para ele (AoE, adds, APL da spec). */
const ABOVE_BOT = 1.1;
/** Um DPS abaixo disso: pode ser o player; vale olhar se for uma spec inteira. */
const BELOW_BOT = 0.7;
/** Specs cujo número não diz nada contra o robô (o dano dela vai nos outros). */
const CONTEXT_SPECS = new Set([1473]); // Augmentation

if (!input) {
  console.error('uso: npm run sim:check -- <WoWCombatLog.txt | relatório.json> [--boss "<nome>"] [--difficulty Mythic] [--iterations 1000]');
  process.exit(1);
}
if (!fs.existsSync(simc)) {
  console.error(`SimC não encontrado em ${simc}: simule uma vez no app (ele baixa) ou aponte WIPE_SIMC_EXE`);
  process.exit(1);
}
fs.mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------- o código do app

/** simProfile.ts e companhia, empacotados (eles importam i18n e afins, que o node sozinho não resolve). */
async function appCode() {
  const entry = path.join(CACHE, 'entry.ts');
  const lib = (f) => JSON.stringify(path.join(ROOT, 'src', 'lib', f).replaceAll('\\', '/'));
  fs.writeFileSync(
    entry,
    [
      `export { pickSimPull, buildSimProfile, fightMovement, raidTargets, targetWindows } from ${lib('simProfile.ts')};`,
      `export { outputPerSec } from ${lib('performance.ts')};`,
      `export { SPEC_NAMES } from ${lib('specs.ts')};`,
    ].join('\n'),
  );
  const file = path.join(CACHE, 'app.mjs');
  await build({ input: entry, platform: 'node', write: true, logLevel: 'silent', output: { file, format: 'esm' }, transform: { define: { 'import.meta.env': '{}' } } });
  return import(`file://${file.replaceAll('\\', '/')}?t=${Date.now()}`);
}

/** Árvore de talentos da spec: o cache do app (talents.json do Raidbots) ou baixada. */
let rawTalents = null;
async function talentTree(specId) {
  if (!rawTalents) {
    const local = [path.join(APP_DATA, 'talents.json'), path.join(CACHE, 'talents.json')].find((f) => fs.existsSync(f));
    if (local) rawTalents = JSON.parse(fs.readFileSync(local, 'utf8'));
    else {
      rawTalents = await (await fetch('https://www.raidbots.com/static/data/live/talents.json')).json();
      fs.writeFileSync(path.join(CACHE, 'talents.json'), JSON.stringify(rawTalents));
    }
  }
  const spec = rawTalents.find((s) => s.specId === specId);
  const out = new Map();
  for (const [key, tree] of [['classNodes', 'class'], ['specNodes', 'spec'], ['heroNodes', 'hero']])
    for (const node of spec?.[key] ?? []) for (const e of node.entries) out.set(e.id, { name: e.name ?? '?', spellId: e.spellId ?? null, icon: null, nodeId: node.id, maxRanks: e.maxRanks ?? 1, tree });
  return out;
}

/** Roda um perfil no SimC (pasta própria por player) e devolve o json2. */
function runSimc(name, profile) {
  const dir = path.join(CACHE, 'run', name.replace(/[^A-Za-z0-9-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.simc'), `${profile}iterations=${ITERATIONS}\n`);
  const threads = Math.max(1, os.availableParallelism() - 1);
  const r = spawnSync(simc, ['input.simc', 'json2=out.json', `threads=${threads}`], { cwd: dir, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (r.status !== 0 || !fs.existsSync(path.join(dir, 'out.json'))) return { error: (r.stderr || r.stdout || 'simc falhou').trim().split('\n').slice(-3).join(' ') };
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')).sim?.players?.[0];
  const dps = p?.collected_data?.dps ?? {};
  return { mean: Number(dps.mean) || 0, min: Number(dps.min) || 0, max: Number(dps.max) || 0 };
}

// ---------------------------------------------------------------- simular a raide

const app = await appCode();
const pulls = loadReport(input, CUTOFF, CACHE).pulls ?? [];
const { pulls: fightPulls, ref, title, night } = bossPulls(pulls, opt('boss'), opt('difficulty'));

const names = [...new Set(fightPulls.flatMap((p) => p.players.filter((x) => x.role !== 'healer').map((x) => x.name)))];
const rows = [];
const fights = new Map();
for (const name of names) {
  const pick = app.pickSimPull(pulls, ref, name);
  const spec = app.SPEC_NAMES[pick?.player.specId ?? -1];
  const label = `${name.split('-')[0]} (${spec ? spec.spec : '?'})`;
  if (!pick) {
    rows.push({ name, label, skip: 'sem pull com setup e 30s vivo' });
    continue;
  }
  const profile = app.buildSimProfile(pick, await talentTree(pick.player.specId));
  if (!profile) {
    rows.push({ name, label, skip: 'spec sem perfil no SimC' });
    continue;
  }
  if (!fights.has(pick.pull.id)) fights.set(pick.pull.id, { pick, input: profile.input });
  process.stdout.write(`simulando ${label}… `);
  const bot = runSimc(name, profile.input);
  const real = app.outputPerSec({ pull: pick.pull, player: pick.player });
  const context = pick.player.role === 'tank' || CONTEXT_SPECS.has(pick.player.specId);
  const pct = bot.mean > 0 ? real / bot.mean : null;
  console.log(bot.error ? `erro: ${bot.error}` : `${Math.round((pct ?? 0) * 100)}%`);
  rows.push({ name, label, role: pick.player.role, specId: pick.player.specId, pull: pick.pull.pullNumber, windowMs: pick.windowMs, kill: pick.kill, alive: pick.alive, real, bot, pct, context, measured: /\/movement,[^\n]*last=/.test(profile.input) });
}

// ---------------------------------------------------------------- relatório

const k = (n) => `${Math.round(n / 1000)}k`;
const pctS = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const dps = rows.filter((r) => r.pct != null && !r.context);
const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const med = median(dps.map((r) => r.pct));

const items = [];
const add = (level, text) => items.push({ level, text });
if (rows.some((r) => r.measured === false)) add('REVISAR', 'Perfil sem o movimento medido: a análise é de um wipe-cli antigo. Recompile o wipe-cli e rode de novo.');
if (med != null && (med < RAID_MEDIAN[0] || med > RAID_MEDIAN[1]))
  add('REVISAR', `Mediana dos DPS em ${pctS(med)} do robô (esperado ${pctS(RAID_MEDIAN[0])}–${pctS(RAID_MEDIAN[1])}): o modelo da luta está ${med < RAID_MEDIAN[0] ? 'fácil demais (o robô anda pouco, tem alvos de menos ou execute demais)' : 'difícil demais (o robô anda demais ou perde alvos)'}.`);
for (const r of rows.filter((r) => r.bot?.error)) add('REVISAR', `${r.label}: o SimC não rodou o perfil (${r.bot.error}).`);
for (const r of dps.filter((r) => r.pct > ABOVE_BOT)) add('REVISAR', `${r.label} fez ${pctS(r.pct)} do robô: o robô está fraco para ele (alvos/adds, execute ou a APL da spec no SimC).`);
for (const r of dps.filter((r) => r.pct < BELOW_BOT)) add('ATENÇÃO', `${r.label} fez ${pctS(r.pct)} do robô: pode ser o player; se a spec inteira ficar baixa em outros bosses, é o modelo.`);
const status = items.some((i) => i.level === 'REVISAR') ? 'REVISAR' : items.length ? 'ATENÇÃO' : 'OK';

const md = [];
md.push(`# Simulação — ${title} (${night})`, '');
md.push(`**${status}** · ${rows.filter((r) => r.pct != null).length} simulados · mediana dos DPS ${pctS(med)} do robô · ${ITERATIONS} iterações · corte em ${CUTOFF || 'nenhuma'} mortes`, '');
if (items.length) md.push(...items.map((i) => `- **${i.level}** ${i.text}`), '');
md.push('## Por player', '', '| Player | Pull | Janela | Real | Robô (faixa) | % do robô | |', '|---|---|---|---|---|---|---|');
for (const r of [...rows].sort((a, b) => (a.pct ?? 9) - (b.pct ?? 9))) {
  if (r.skip) md.push(`| ${r.label} | — | — | — | — | — | ${r.skip} |`);
  else
    md.push(
      `| ${r.label} | ${r.pull}${r.kill ? ' (kill)' : ''} | ${mmss(r.windowMs)}${r.alive ? '' : ' (morreu)'} | ${k(r.real)} | ${r.bot.error ? 'erro' : `${k(r.bot.mean)} (${k(r.bot.min)}–${k(r.bot.max)})`} | ${pctS(r.pct)} | ${r.context ? (r.role === 'tank' ? 'tank: só contexto' : 'só contexto') : ''} |`,
    );
}
md.push('', '## O que o robô jogou', '');
for (const { pick, input: profile } of fights.values()) {
  const p = pick.pull;
  const line = (key) => profile.split('\n').find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);
  const moves = app.fightMovement(p, pick.windowMs);
  const targets = app.targetWindows(app.raidTargets(p), pick.windowMs).filter(([a, b, n]) => b - a >= 6000 && n !== 1);
  md.push(`### Pull ${p.pullNumber} · janela ${mmss(pick.windowMs)} de ${mmss(p.durationMs)}${p.success ? ' · kill' : ''}`, '');
  md.push(`- **Fases:** ${(p.phaseMarks ?? []).filter((m) => m.t < pick.windowMs).map((m) => `${m.key} ${mmss(m.t)}`).join(' · ') || '—'}`);
  md.push(`- **Vida do boss no fim:** ${line('enemy_death_pct') ?? '?'}% (bosses: ${p.bosses.map((b) => `${b.name} ${Math.round(b.hpPctAtCutoff ?? b.hpPct ?? 0)}%`).join(', ')}; fase no corte: ${p.phaseHpPctAtCutoff != null ? `${Math.round(p.phaseHpPctAtCutoff)}%` : '—'})`);
  const hpLine = (p.bossHpTimeline ?? []).slice(0, Math.ceil(pick.windowMs / 5000));
  const below = (x) => hpLine.filter((v) => v < x * 10).length * 5;
  md.push(`- **Execute:** ${hpLine.length ? `a luta ficou ${below(20)}s abaixo de 20% e ${below(35)}s abaixo de 35% (somando as fases); o robô vai em reta de 100% a ${line('enemy_death_pct')}%` : 'sem a vida por fase (análise antiga): reta até a vida no corte'}`);
  md.push(`- **Bloodlust:** ${line('override.bloodlust') === '1' ? `aos ${line('bloodlust_time')}s` : 'não'}`);
  md.push(`- **Movimento:** ${moves ? moves.map((m) => `${mmss(m.from)}–${mmss(m.to)} ${Math.round(m.share * 100)}%`).join(' · ') : 'padrão do SimC (sem medida)'}`);
  md.push(`- **Alvos:** ${targets.map(([a, b, n]) => `${mmss(a)}–${mmss(b)} ${n === 0 ? 'sem alvo' : `${n} alvos`}`).join(' · ') || 'alvo único'}`, '');
}
const file = writeReport(OUT, title, md.join('\n'), { title, night, status, median: med, items, rows });
console.log(`\n${status} · mediana ${pctS(med)} · ${file}.md`);
