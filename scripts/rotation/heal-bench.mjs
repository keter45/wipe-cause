// Referência dos healers: roda o motor nos logs de referência baixados (scripts/rotation/heal-refs.mjs)
// e guarda, log a log, o que o app compara com o healer da guilda (src/lib/healer.ts). Fica log a log
// (não agregado) porque a referência é escolhida na hora pela composição de healers da nossa raid e
// sem os logs distorcidos (regras em docs/healer-analysis.md).
//
//   node --experimental-strip-types scripts/rotation/heal-bench.mjs [spec ...]
//
// Sem specs, todas as de cura que têm refs baixadas. Escreve src/data/heal-refs/<spec>.json e, no
// fim, confere a tabela de CDs de cura (data/heal-cooldowns.json, note de CDs: docs/heal-cd-note.md)
// contra as referências e a rotação da spec: OK / ATENÇÃO / REVISAR.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HEALER_SPECS, findSpec } from './specs.mjs';
import { anchorTimes } from '../../src/lib/benchMetrics.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');
const HEAL_CDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'heal-cooldowns.json'), 'utf8')).cooldowns;
/** CD de healer a partir disso de recarga entra na conferência da tabela de CDs. */
const TABLE_MIN_CD_MS = 60_000;
const OUT = path.join(ROOT, 'src', 'data', 'heal-refs');
/** Habilidades de cura guardadas por log (as que mais curam). */
const TOP_SPELLS = 12;
/** Cooldown com mais usos possíveis que isso na luta é de recarga curta: o momento dele não entra. */
const MAX_TIMED_CASTS = 10;
/** Nome de habilidade: os logs vêm em várias línguas; fica o primeiro em inglês (ASCII) que aparecer. */
const ascii = (x) => /^[ -~]*$/.test(x);
function setName(names, id, name) {
  if (name && (!names[id] || (!ascii(names[id]) && ascii(name)))) names[id] = name;
}
const round = (x, d = 3) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

function cli() {
  const exe = path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'wipe-cli.exe' : 'wipe-cli');
  const b = spawnSync('cargo', ['build', '--release', '-q', '-p', 'wipe-core', '--bin', 'wipe-cli'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('cargo build do wipe-cli falhou');
  return exe;
}

/** Um log de referência resumido no que a comparação usa (`cdHealIds`: curas dos CDs da tabela). */
function entry(ref, pull, p, names, cdHealIds) {
  const r = p.rotation;
  const secs = pull.analyzedMs / 1000;
  const allHeal = Object.fromEntries((p.healingBySpell ?? []).map((s) => [s.spellId, s.amount]));
  const heal = Object.fromEntries((p.healingBySpell ?? []).slice(0, TOP_SPELLS).map((s) => [s.spellId, s.amount]));
  const over = Object.fromEntries((p.overhealBySpell ?? []).map((s) => [s.spellId, s.amount]));
  for (const s of [...(p.healingBySpell ?? []), ...(p.overhealBySpell ?? [])]) setName(names, s.spellId, s.name);
  const total = p.healingDone || 1;
  const overTotal = Object.values(over).reduce((a, b) => a + b, 0);
  const spellRow = (id, amount) => ({
    share: round(amount / total),
    overheal: round((over[id] ?? 0) / (amount + (over[id] ?? 0))),
  });
  const cdTimes = {};
  // usos de cada cooldown grande (ms do pull), para o momento preso à mecânica do boss
  const cdUses = {};
  // momento dos cooldowns grandes (os de recarga curta, como Holy Shock, não dizem nada da luta)
  for (const c of r.cooldowns ?? []) {
    setName(names, c.spellId, c.name);
    if (c.possible > MAX_TIMED_CASTS) continue;
    const times = (p.casts ?? []).filter((x) => x.spellId === c.spellId).flatMap((x) => x.times);
    cdTimes[c.spellId] = times.map((t) => round(t / pull.analyzedMs, 3));
    cdUses[c.spellId] = times;
  }
  const ally = {};
  for (const u of (r.uptimes ?? []).filter((u) => u.kind === 'ally')) {
    setName(names, u.id, u.name);
    ally[u.id] = { uptime: round(u.uptime), targets: round(u.targets ?? 0, 2) };
  }
  return {
    name: ref.name,
    code: ref.code,
    fight: ref.fight,
    region: ref.region,
    healers: ref.healers.map((h) => h.spec).sort(),
    players: ref.players,
    share: round(ref.share),
    // dano tomado pela raid por segundo: o sinal de raid tomando dano a mais para inflar a cura
    dtps: Math.round(ref.damageTaken / (ref.durationMs / 1000)),
    durationMs: ref.durationMs,
    startTime: ref.startTime,
    hps: Math.round(p.healingDone / secs),
    idle: round(r.activeMs > 0 ? r.downtimeMs / r.activeMs : null),
    manaEnd: p.manaTimeline?.length ? p.manaTimeline.at(-1) : null,
    manaMid: p.manaTimeline?.length ? p.manaTimeline[Math.floor(p.manaTimeline.length / 2)] : null,
    overheal: round(overTotal / (total + overTotal)),
    spells: Object.fromEntries(Object.keys(heal).map((id) => [id, spellRow(id, heal[id])])),
    // a cura dos CDs mesmo fora das maiores: régua do overheal na note de CDs
    cdSpells: Object.fromEntries(cdHealIds.filter((id) => allHeal[id]).map((id) => [id, spellRow(id, allHeal[id])])),
    checks: Object.fromEntries(r.findings.map((f) => [f.id, round(f.rate)])),
    cooldowns: Object.fromEntries((r.cooldowns ?? []).map((c) => [c.spellId, round(c.usage)])),
    cdPossible: Object.fromEntries((r.cooldowns ?? []).map((c) => [c.spellId, c.possible])),
    casts: Object.fromEntries((p.casts ?? []).map((c) => [c.spellId, c.times.length])),
    cdTimes,
    cdUses,
    // casts do boss que servem de marco (spell -> tempos)
    anchors: Object.fromEntries([...anchorTimes(pull)].map(([id, a]) => (setName(names, id, a.name), [id, a.times]))),
    ally,
  };
}

function bench(exe, spec) {
  const base = path.join(ROOT, 'samples', 'rotation', spec.file, 'refs');
  const refsFile = path.join(base, 'refs.json');
  if (!fs.existsSync(refsFile)) return null;
  const refs = JSON.parse(fs.readFileSync(refsFile, 'utf8'));
  const env = { ...process.env };
  delete env.WIPE_ROTATIONS;
  const names = {};
  const bosses = {};
  const kinds = {};
  const checkedAlly = new Set();
  const cdHealIds = HEAL_CDS.filter((c) => c.specs?.includes(spec.id)).flatMap((c) => (c.heal_ids ?? []).map(String));
  for (const [code, list] of Object.entries(Object.groupBy(refs, (r) => r.code))) {
    const dir = path.join(base, code.replace(/[:\\/]/g, '_'));
    if (!list.some((r) => fs.existsSync(path.join(dir, `fight-${r.fight}.json`)))) continue;
    const run = spawnSync(exe, ['wcl', dir, '--json'], {
      env,
      maxBuffer: 1 << 30,
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`wipe-cli wcl ${dir}: ${run.stderr}`);
    const pulls = JSON.parse(run.stdout).pulls;
    for (const ref of list) {
      const pull = pulls.find((p) => p.encounterName === ref.encounter && p.success && p.difficultyId === 16) ?? pulls.find((p) => p.encounterName === ref.encounter);
      const p = pull?.players.find((x) => x.specId === spec.id && x.name.split('-')[0] === ref.name && x.rotation);
      if (!p) {
        console.log(`  ${spec.name}: ${ref.name} (${ref.code} fight ${ref.fight}) sem leitura, pulando`);
        continue;
      }
      (bosses[ref.encounter] ??= []).push(entry(ref, pull, p, names, cdHealIds));
      for (const f of p.rotation.findings) {
        kinds[f.id] = f.kind;
        if (f.kind === 'ally_uptime' && f.spellId != null) checkedAlly.add(f.spellId);
      }
    }
  }
  return {
    spec: spec.id,
    name: spec.name,
    names,
    kinds,
    checkedAlly: [...checkedAlly],
    bosses,
  };
}

/** Habilidades da rotação da spec com recarga (rotations/<spec>.yaml, linhas de `abilities`). */
function rotationCooldowns(spec) {
  const file = path.join(ROOT, 'rotations', `${spec.file}.yaml`);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^ {2}\w+: \{ id: (\d+), name: ("[^"]*"|[^,]*),.*?cooldown_ms: (\d+)/gm))
    out.push({ id: +m[1], name: m[2].replace(/^"|"$/g, ''), cooldownMs: +m[3] });
  return out;
}

/**
 * A tabela de CDs de cura contra as referências da spec: cura de CD que nenhuma referência tem
 * (ATENÇÃO: id errado ou CD que ninguém usa) e CD de 60 s ou mais da rotação, castado nas
 * referências, sem entrada na tabela (REVISAR: falta classificar; entrada sem `kind` = não é CD de
 * raide).
 */
function tableReport(spec, b) {
  const entries = Object.values(b.bosses).flat();
  const lines = [];
  for (const c of HEAL_CDS.filter((c) => c.specs?.includes(spec.id))) {
    for (const id of c.heal_ids ?? []) {
      const n = entries.filter((e) => e.cdSpells?.[id]).length;
      lines.push(n ? ['OK', `${c.name}: cura ${id} em ${n} de ${entries.length} referências`] : ['ATENÇÃO', `${c.name}: cura ${id} em nenhuma referência`]);
    }
  }
  const known = new Set(HEAL_CDS.flatMap((c) => [c.id, ...(c.alt_ids ?? [])]));
  for (const a of rotationCooldowns(spec)) {
    if (a.cooldownMs < TABLE_MIN_CD_MS || known.has(a.id)) continue;
    const n = entries.filter((e) => e.casts?.[a.id]).length;
    if (n) lines.push(['REVISAR', `${a.name} (${a.id}, recarga ${a.cooldownMs / 1000} s) castado em ${n} referências e fora da tabela`]);
  }
  return lines;
}

const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const specs = keys.length ? keys.map(findSpec) : HEALER_SPECS.filter((s) => fs.existsSync(path.join(ROOT, 'samples', 'rotation', s.file, 'refs', 'refs.json')));
const exe = cli();
fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const spec of specs) {
  const b = bench(exe, spec);
  if (!b) continue;
  fs.writeFileSync(path.join(OUT, `${spec.file}.json`), JSON.stringify(b));
  const n = Object.values(b.bosses).reduce((a, l) => a + l.length, 0);
  console.log(`${spec.name}: ${n} logs de referência em ${Object.keys(b.bosses).length} chefes -> src/data/heal-refs/${spec.file}.json`);
  report.push([spec.name, tableReport(spec, b)]);
}
console.log('\nTabela de CDs de cura (data/heal-cooldowns.json)');
for (const [name, lines] of report) {
  console.log(`  ${name}`);
  for (const [level, text] of lines.length ? lines : [['OK', 'nada a conferir']]) console.log(`    ${level.padEnd(8)}${text}`);
}
