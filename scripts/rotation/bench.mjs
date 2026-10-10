// Referência dos tops por boss: roda o motor nos tops baixados de cada spec e resume, boss a boss, o
// que o app compara com o pull do player (src/components/BossBench.tsx): tempo parado, casts por
// minuto, checagens da rotação, a abertura dos tops (por árvore de herói), uso e momento dos cooldowns, a fatia de cada habilidade nos casts (AoE x
// alvo único), poção, o que acontece
// depois de cada mecânica do boss (tempo parado e o que eles castam) e os defensivos nas mecânicas.
//
//   node --experimental-strip-types scripts/rotation/bench.mjs [spec ...] [--dirs a,b --out pasta]
//
// Sem specs, todas as que têm tops baixados. Escreve src/data/bench/<spec>.json. --dirs: outras
// pastas no formato do download (ex.: um log da guild, para testar), escrevendo em --out.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSpec, SPECS } from './specs.mjs';
import {
  ANCHOR_WINDOW_MS,
  EARLY_MS,
  anchorTimes,
  castMix,
  castsIn,
  cpm,
  defensivesNear,
  downtimePct,
  firstUse,
  idleIn,
  potionTimes,
} from '../../src/lib/benchMetrics.ts';
import { buildDecisionRef, discoverConsumers, discoverCooldowns, povOf } from '../../src/lib/decisions.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');
/** Pulls mínimos de um boss para ele ter referência. */
const MIN_PULLS = 3;
/** Marco (k-ésimo cast de uma habilidade do boss) que aparece em pelo menos isso dos pulls. */
const ANCHOR_SHARE = 0.7;
/** Defensivo numa mecânica: só entra se os tops usam em pelo menos isso das vezes. */
const DEF_MIN_SHARE = 0.3;
/** Habilidade que eles usam depois de uma mecânica: pelo menos isso a mais que a fatia dela na luta. */
const USE_LIFT = 1.5;
/** Abertura: os primeiros casts da rotação comparados (o motor guarda até 10 na janela da abertura). */
const OPENER_CASTS = 8;
/** Abre "igual": até isso de casts de diferença (trocados, a mais ou a menos) da abertura típica. */
const OPENER_CLOSE = 2;

/** Distância de edição entre duas sequências de casts (inserir, tirar ou trocar um cast custa 1). */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Abertura dos tops no boss, por árvore de herói (muda com o boss e com os talentos): a sequência de
 * um top real que mais se parece com a dos outros, e quantos abrem assim.
 */
function bossOpeners(list) {
  const out = {};
  const withOpener = list.filter((x) => x.player.rotation.opener?.actual?.length);
  for (const [tree, group] of Object.entries(Object.groupBy(withOpener, (x) => x.player.rotation.tree ?? '?'))) {
    if (group.length < MIN_PULLS) continue;
    const seqs = group.map((x) => x.player.rotation.opener.actual.slice(0, OPENER_CASTS));
    const ids = seqs.map((s) => s.map((c) => c.spellId));
    const total = ids.map((a) => ids.reduce((sum, b) => sum + editDistance(a, b), 0));
    const best = total.indexOf(Math.min(...total));
    const close = ids.filter((b) => editDistance(ids[best], b) <= OPENER_CLOSE).length;
    out[tree] = { n: group.length, support: round(close / group.length, 2), seq: seqs[best].map((c) => ({ spellId: c.spellId, name: en(c.spellId, c.name) })) };
  }
  return out;
}

// o mesmo critério de performance.ts (isCombatPotion)
const POTION = /potion|poção|pocao|elixir|flask|frasco/i; // i18n-ignore
const HEALTH = /health|healing|vida|cura|healthstone|pedra de vida/i; // i18n-ignore
const COMBAT_POTION_NAMES = ["Light's Potential", 'Potion of Recklessness', 'Tempered Potion', 'Potion of Unwavering Focus'];
const isPotion = (name) => (POTION.test(name) && !HEALTH.test(name)) || COMBAT_POTION_NAMES.includes(name);

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
/** Nome em inglês por spell (os reports de outros países vêm com o nome traduzido). */
const names = new Map();
const ASCII = /^[ -~’]+$/;
function learnNames(pulls) {
  const add = (id, name, trusted) => {
    if (!name || (names.has(id) && !trusted)) return;
    if (trusted || ASCII.test(name)) names.set(id, name);
  };
  // as da rotação vêm do YAML (inglês); as outras, do primeiro report em inglês
  for (const { player: p } of pulls) for (const a of [...p.rotation.prioritySt, ...p.rotation.priorityAoe, ...p.rotation.cooldowns]) add(a.spellId, a.name, true);
  for (const { pull, player: p } of pulls) {
    for (const c of p.casts) add(c.spellId, c.name);
    for (const d of p.defensivesUsed) add(d.spellId, d.name);
    for (const b of p.rotation.buffs ?? []) add(b.id, b.name);
    for (const e of pull.enemySpells) add(e.spellId, e.name);
  }
}
const en = (id, name) => names.get(+id) ?? name;

const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function cli() {
  const exe = path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'wipe-cli.exe' : 'wipe-cli');
  const b = spawnSync('cargo', ['build', '--release', '-q', '-p', 'wipe-core', '--bin', 'wipe-cli'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('cargo build do wipe-cli falhou');
  return exe;
}

/** Cada pull de cada top da spec: { pull, player } (só quem tem leitura de rotação). */
function topPulls(exe, spec) {
  const tops = path.join(ROOT, 'samples', 'rotation', spec.file, 'tops');
  const out = [];
  const dirs = opt('dirs')?.split(',').map((d) => path.resolve(d)) ?? fs.readdirSync(tops).map((d) => path.join(tops, d));
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(dir, 'report.json'))) continue;
    const env = { ...process.env };
    delete env.WIPE_ROTATIONS;
    const r = spawnSync(exe, ['wcl', dir, '--json'], { env, maxBuffer: 1 << 30, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`wipe-cli wcl ${dir}: ${r.stderr}`);
    for (const pull of JSON.parse(r.stdout).pulls) {
      if (pull.analyzedMs < 60000) continue;
      for (const player of pull.players) if (player.specId === spec.id && player.rotation && player.casts.length) out.push({ pull, player });
    }
  }
  return out;
}

/** Pulls mínimos de uma árvore para a referência de decisões, e de um boss para os cooldowns dele. */
const MIN_DECISION_PULLS = 8;
const MIN_BOSS_CD_PULLS = 6;

/**
 * Decisões por árvore de herói: quem gasta cada proc e quanto os tops perdem, e os cooldowns
 * (segurados ou alinhados). Os cooldowns também por boss, quando há tops suficientes nele: segurar
 * para uma fase ou mecânica muda de boss para boss.
 */
function specDecisions(pulls, bosses) {
  const out = {};
  for (const [tree, group] of Object.entries(Object.groupBy(pulls, (x) => x.player.rotation.tree ?? '?'))) {
    const povs = group.map((x) => ({ x, pov: povOf(x.pull, x.player) })).filter((g) => g.pov);
    if (povs.length < MIN_DECISION_PULLS) continue;
    const all = povs.map((g) => g.pov);
    const consumers = discoverConsumers(all);
    const cooldowns = discoverCooldowns(all);
    out[tree] = buildDecisionRef(all, consumers, cooldowns, en);
    for (const [id, list] of Object.entries(Object.groupBy(povs, (g) => g.x.pull.encounterId))) {
      if (list.length < MIN_BOSS_CD_PULLS || !bosses[id]) continue;
      (bosses[id].cds ??= {})[tree] = buildDecisionRef(list.map((g) => g.pov), consumers, cooldowns, en).cds;
    }
  }
  return out;
}

function boss(list) {
  const rot = (x) => x.player.rotation;
  const checks = {};
  for (const x of list) for (const f of rot(x).findings) (checks[f.id] ??= []).push(f.rate);
  const cds = {};
  for (const x of list)
    for (const c of rot(x).cooldowns) {
      const e = (cds[c.spellId] ??= { name: en(c.spellId, c.name), usage: [], first: [] });
      e.usage.push(c.usage);
      e.first.push(firstUse(x.player, c.spellId));
    }
  const potions = list.map((x) => potionTimes(x.player, isPotion));
  const mixes = list.map((x) => castMix(x.player, rot(x)));
  const mixIds = new Map(mixes.flatMap((m) => [...m].map(([id, v]) => [id, v.name])));
  const mixShare = (id) => median(mixes.map((m) => m.get(id)?.share ?? 0)) ?? 0;

  // só as lutas com os casts do boss (as baixadas antes deles não têm): sem o bastante, sem marcos
  const timed = list.filter((x) => x.pull.enemySpells.some((e) => e.castTimes?.length));
  if (timed.length < MIN_PULLS) timed.length = 0;
  // marcos: o k-ésimo cast de cada habilidade do boss que aparece em ANCHOR_SHARE dos pulls
  const perPull = timed.map((x) => anchorTimes(x.pull));
  const spells = new Map();
  for (const m of perPull) for (const [id, a] of m) spells.set(id, en(id, a.name));
  const anchors = [];
  const defensives = [];
  for (const [spellId, name] of spells) {
    const times = perPull.map((m) => m.get(spellId)?.times ?? []);
    for (let k = 0; ; k++) {
      const have = timed.map((x, i) => ({ x, t: times[i][k] })).filter((h) => h.t != null && h.t < aliveUntil(h.x));
      if (have.length < timed.length * ANCHOR_SHARE) break;
      // o que eles castam ali mais do que no resto da luta (instantâneas no movimento, AoE nos adds)
      const use = {};
      let inWindow = 0;
      for (const h of have)
        for (const c of castsIn(h.x.player, rot(h.x), h.t, h.t + ANCHOR_WINDOW_MS)) {
          const u = (use[c.spellId] ??= { name: en(c.spellId, c.name), pulls: 0, n: 0 });
          u.pulls++;
          u.n += c.n;
          inWindow += c.n;
        }
      anchors.push({
        spellId,
        name,
        k,
        t: Math.round(median(have.map((h) => h.t))),
        idle: Math.round(median(have.map((h) => idleIn(rot(h.x).idle, h.t, h.t + ANCHOR_WINDOW_MS)))),
        use: Object.entries(use)
          .map(([id, u]) => ({ spellId: +id, name: u.name, share: round(u.pulls / have.length, 2), lift: u.n / inWindow / Math.max(0.01, mixShare(+id)) }))
          .filter((u) => u.share >= 0.5 && u.lift >= USE_LIFT)
          .sort((a, b) => b.lift - a.lift)
          .slice(0, 3)
          .map(({ lift, ...u }) => u),
      });
    }
    // defensivos: todas as vezes que a habilidade saiu com o top vivo
    let seen = 0;
    let withDef = 0;
    const used = {};
    timed.forEach((x, i) => {
      for (const t of times[i].filter((t) => t < aliveUntil(x))) {
        seen++;
        const near = defensivesNear(x.player, t);
        if (near.length) withDef++;
        for (const d of new Map(near.map((d) => [d.spellId, d])).values()) (used[d.spellId] ??= { name: en(d.spellId, d.name), n: 0 }).n++;
      }
    });
    const pullsWith = times.filter((ts) => ts.length).length;
    if (seen && pullsWith >= timed.length * ANCHOR_SHARE && withDef / seen >= DEF_MIN_SHARE)
      defensives.push({
        spellId,
        name,
        share: round(withDef / seen, 2),
        spells: Object.entries(used)
          .map(([id, u]) => ({ spellId: +id, name: u.name, share: round(u.n / seen, 2) }))
          .sort((a, b) => b.share - a.share)
          .slice(0, 3),
      });
  }

  return {
    n: list.length,
    downtimePct: round(median(list.map((x) => downtimePct(rot(x))))),
    cpm: round(median(list.map((x) => cpm(x.player, rot(x)))), 1),
    checks: Object.fromEntries(Object.entries(checks).map(([id, rs]) => [id, round(median(rs))])),
    cooldowns: Object.fromEntries(
      Object.entries(cds).map(([id, c]) => {
        const used = c.first.filter((t) => t != null);
        return [id, { name: c.name, usage: round(median(c.usage)), first: used.length ? Math.round(median(used)) : null, early: used.length ? round(used.filter((t) => t <= EARLY_MS).length / used.length, 2) : null }];
      }),
    ),
    // pull sem a habilidade conta como 0%
    mix: Object.fromEntries([...mixIds].map(([id, name]) => [id, { name: en(id, name), share: round(median(mixes.map((m) => m.get(id)?.share ?? 0))) }])),
    potion: {
      used: round(potions.filter((p) => p.length).length / list.length, 2),
      first: potions.some((p) => p.length) ? Math.round(median(potions.map((p) => p[0]))) : null,
      second: potions.filter((p) => p.length > 1).length >= MIN_PULLS ? Math.round(median(potions.map((p) => p[1]))) : null,
    },
    openers: bossOpeners(list),
    anchors: dedupe(anchors.sort((a, b) => a.t - b.t)),
    // versões da mesma magia (mesmo nome): fica a de maior fatia
    defensives: defensives.sort((a, b) => b.share - a.share).filter((d, i, all) => all.findIndex((x) => x.name === d.name) === i),
  };
}

/** Versões da mesma magia do boss (mesmo nome, quase no mesmo instante) viram um marco só. */
function dedupe(anchors) {
  const kept = [];
  for (const a of anchors) if (!kept.some((k) => k.name === a.name && Math.abs(k.t - a.t) < 2000)) kept.push(a);
  return kept;
}

/** Até quando o top estava vivo no pull (morto, a janela não conta). */
function aliveUntil(x) {
  const d = x.pull.deaths.find((d) => d.guid === x.player.guid);
  return d ? d.t : Infinity;
}

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const args = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const OUT = opt('out') ? path.resolve(opt('out')) : path.join(ROOT, 'src', 'data', 'bench');
const specs = args.length
  ? args.map(findSpec)
  : SPECS.filter((s) => fs.existsSync(path.join(ROOT, 'samples', 'rotation', s.file, 'tops')) && fs.existsSync(path.join(ROOT, 'rotations', `${s.file}.yaml`)));
const exe = cli();
fs.mkdirSync(OUT, { recursive: true });
for (const spec of specs) {
  const pulls = topPulls(exe, spec);
  learnNames(pulls);
  const byBoss = Object.groupBy(pulls, (x) => x.pull.encounterId);
  const bosses = {};
  // a dificuldade dos tops (Mítico; Heroico só se não houve ranking): abertura e mecânicas mudam com ela
  const mostCommon = (xs) => Object.entries(Object.groupBy(xs, (x) => x)).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  for (const [id, list] of Object.entries(byBoss)) if (list.length >= MIN_PULLS) bosses[id] = { name: list[0].pull.encounterName, difficultyId: +mostCommon(list.map((x) => x.pull.difficultyId)), ...boss(list) };
  const decisions = specDecisions(pulls, bosses);
  const file = path.join(OUT, `${spec.file}.json`);
  // compacto: vai embutido no app
  fs.writeFileSync(file, JSON.stringify({ spec: spec.id, name: spec.name, pulls: pulls.length, decisions, bosses }));
  const anchors = Object.values(bosses).reduce((s, b) => s + b.anchors.length, 0);
  console.log(`${spec.name}: ${pulls.length} pulls, ${Object.keys(bosses).length} bosses, ${anchors} marcos de mecânica -> ${path.relative(ROOT, file)}`);
}
