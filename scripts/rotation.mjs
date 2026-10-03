// Rotação base de uma spec gerada sem escrever à mão: APL + dados de spell do SimulationCraft para o
// rascunho, e os logs dos tops do Warcraft Logs para calibrar. Ferramenta de desenvolvimento.
//
//   node scripts/rotation.mjs tops <spec> [--difficulty 5] [--per-boss 2]
//       baixa os tops da spec (sem buffs externos) em cada chefe do raide: samples/rotation/<spec>/tops/
//       (credenciais só por variável de ambiente: WCL_CLIENT_ID e WCL_CLIENT_SECRET)
//   node scripts/rotation.mjs calibrate <spec> [--dirs a,b] [--force]
//       gera o rascunho, roda nos tops pelo motor do app, ajusta as metas e tira o que nem os tops
//       cumprem; escreve rotations/<spec>.yaml (ou samples/rotation/<spec>/ se já existir uma escrita
//       à mão, a menos que --force)
//   node scripts/rotation.mjs gen <spec> [--dirs a,b] [--force]
//       só o rascunho (usa a calibração anterior, se houver)
//   node scripts/rotation.mjs check <spec> [--dirs a,b]
//       roda a rotação atual (rotations/) nos tops e mostra como eles se saem em cada checagem
//
// <spec>: "unholy", "deathknight-unholy" ou o id (252). --dirs: pastas no formato do
// scripts/wcl-fetch.mjs (ex.: samples/wcl-<código>), em vez dos tops baixados.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSpec, token } from './rotation/specs.mjs';
import { loadApl, loadDump, parseDump } from './rotation/simc.mjs';
import { readLogs } from './rotation/logs.mjs';
import { generate } from './rotation/generate.mjs';
import { toYaml } from './rotation/yaml.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const [cmd, key, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
if (!cmd || !key) {
  console.error('uso: node scripts/rotation.mjs <tops|calibrate|gen|check> <spec> [opções] (detalhes no começo do arquivo)');
  process.exit(2);
}
const spec = findSpec(key);
const WORK = path.join(ROOT, 'samples', 'rotation', spec.file);
const TOPS = path.join(WORK, 'tops');

function dataDirs() {
  const given = opt('dirs');
  const dirs = given
    ? given.split(',').map((d) => path.resolve(d))
    : fs.existsSync(TOPS)
      ? fs.readdirSync(TOPS).map((d) => path.join(TOPS, d)).filter((d) => fs.existsSync(path.join(d, 'report.json')))
      : [];
  if (!dirs.length) throw new Error(`sem logs: rode "node scripts/rotation.mjs tops ${spec.file}" ou passe --dirs`);
  return dirs;
}

// ---------------------------------------------------------------- motor (wipe-cli)

function cli() {
  const exe = path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'wipe-cli.exe' : 'wipe-cli');
  if (!fs.existsSync(exe) || flag('build')) {
    const b = spawnSync('cargo', ['build', '--release', '-q', '-p', 'wipe-core', '--bin', 'wipe-cli'], { cwd: ROOT, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('cargo build do wipe-cli falhou');
  }
  return exe;
}

/** Roda o motor nas pastas e devolve a leitura da rotação de cada pull dos players da spec. */
function runEngine(dirs, rotationsDir) {
  const exe = cli();
  const out = [];
  for (const dir of dirs) {
    const env = { ...process.env };
    if (rotationsDir) env.WIPE_ROTATIONS = rotationsDir;
    else delete env.WIPE_ROTATIONS;
    const r = spawnSync(exe, ['wcl', dir, '--json'], { env, maxBuffer: 1 << 30, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`wipe-cli wcl ${dir}: ${r.stderr}`);
    const report = JSON.parse(r.stdout);
    const errs = (report.ruleErrors ?? []).filter((e) => /rotation|\.yaml/.test(e) && (!rotationsDir || e.includes(rotationsDir) || e.includes(spec.file)));
    if (errs.length) throw new Error(`rotação inválida:\n  ${errs.join('\n  ')}`);
    for (const p of report.pulls) {
      if (p.analyzedMs < 60000) continue;
      for (const pl of p.players) {
        if (pl.specId === spec.id && pl.rotation) out.push({ name: pl.name, encounter: p.encounterName, kill: p.success, rotation: pl.rotation });
      }
    }
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const q25 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * 0.25)];
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);

function aggregate(results) {
  const cal = { n: results.length, checks: {}, cooldowns: {}, downtimePct: [], trees: {}, opener: 0 };
  for (const { rotation: r } of results) {
    for (const f of r.findings) (cal.checks[f.id] ??= { title: f.title, rates: [] }).rates.push(f.rate);
    for (const c of r.cooldowns) (cal.cooldowns[c.name] ??= []).push(c.usage);
    if (r.activeMs > 0) cal.downtimePct.push(r.downtimeMs / r.activeMs);
    cal.trees[r.tree ?? '?'] = (cal.trees[r.tree ?? '?'] ?? 0) + 1;
    if (r.opener?.ok) cal.opener++;
  }
  return cal;
}

function printTable(cal) {
  console.log(`\n${cal.n} pulls de ${spec.name}; árvores: ${Object.entries(cal.trees).map(([t, n]) => `${t} ${n}`).join(', ')}; abertura certa em ${pct(cal.opener / Math.max(1, cal.n))}`);
  console.log(`  ${'checagem'.padEnd(36)} ${'mediana'.padStart(8)} ${'p25'.padStart(6)}`);
  for (const [id, c] of Object.entries(cal.checks)) console.log(`  ${(c.title ?? id).slice(0, 36).padEnd(36)} ${pct(median(c.rates)).padStart(8)} ${pct(q25(c.rates)).padStart(6)}`);
  for (const [name, u] of Object.entries(cal.cooldowns)) console.log(`    cooldown ${name.slice(0, 27).padEnd(27)} ${pct(median(u)).padStart(8)} ${pct(q25(u)).padStart(6)}`);
  console.log(`  tempo parado: mediana ${pct(median(cal.downtimePct))}`);
}

// ---------------------------------------------------------------- comandos

async function build(calibration) {
  const [aplText, dumpText] = await Promise.all([loadApl(spec), loadDump(spec)]);
  const logs = readLogs(dataDirs(), spec);
  if (!logs.players.length) throw new Error(`nenhum player ${spec.name} nos logs`);
  const out = await generate({ spec, aplText, dump: parseDump(dumpText), logs, calibration });
  const header = [
    `${spec.name} — rotação base GERADA por scripts/rotation.mjs (revise os textos antes de publicar).`,
    'Prioridade e checagens a partir da APL e dos dados de spell do SimulationCraft (branch midnight);',
    `ids pelos casts de ${logs.players.length} pulls nos logs${calibration ? `; metas calibradas em ${calibration.n} pulls dos tops` : ''}.`,
    ...(out.removed.length ? ['', 'Removido na calibração:', ...out.removed.map((r) => `  - ${r}`)] : []),
  ];
  return { ...out, yaml: toYaml(out.model, header), players: logs.players.length };
}

function writeOut(yaml) {
  const target = path.join(ROOT, 'rotations', `${spec.file}.yaml`);
  const handWritten = fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes('GERADA por scripts/rotation.mjs');
  const dest = handWritten && !flag('force') ? path.join(WORK, `${spec.file}.yaml`) : target;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, yaml);
  console.log(`\nescrito em ${path.relative(ROOT, dest)}${dest !== target ? ' (rotations/ tem uma versão escrita à mão; --force para trocar)' : ''}`);
}

async function main() {
  if (cmd === 'tops') return (await import('./rotation/tops.mjs')).downloadTops(spec, TOPS, { difficulty: +opt('difficulty', 5), perBoss: +opt('per-boss', 2) });

  if (cmd === 'check') {
    const cal = aggregate(runEngine(dataDirs(), null));
    if (!cal.n) throw new Error(`nenhuma leitura de rotação para ${spec.name} (a spec tem YAML em rotations/?)`);
    return printTable(cal);
  }

  const calPath = path.join(WORK, 'calibration.json');
  if (cmd === 'gen') {
    const cal = fs.existsSync(calPath) ? JSON.parse(fs.readFileSync(calPath, 'utf8')) : null;
    const g = await build(cal);
    for (const n of g.notes) console.log(`- ${n}`);
    return writeOut(g.yaml);
  }

  if (cmd === 'calibrate') {
    const draft = await build(null);
    for (const n of draft.notes) console.log(`- ${n}`);
    const draftDir = path.join(WORK, 'draft');
    fs.mkdirSync(draftDir, { recursive: true });
    for (const f of fs.readdirSync(draftDir)) fs.rmSync(path.join(draftDir, f));
    fs.writeFileSync(path.join(draftDir, `${spec.file}.yaml`), draft.yaml);
    const cal = aggregate(runEngine(dataDirs(), draftDir));
    if (!cal.n) throw new Error('o motor não leu nenhum pull da spec com o rascunho');
    fs.writeFileSync(calPath, JSON.stringify(cal, null, 2));
    printTable(cal);
    const final = await build(cal);
    if (final.removed.length) console.log(`\nremovido:\n${final.removed.map((r) => `  - ${r}`).join('\n')}`);
    return writeOut(final.yaml);
  }
  throw new Error(`comando desconhecido: ${cmd}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
