// Atualiza tudo o que muda com patch, raide nova, buffs e nerfs, sem IA: a APL do SimulationCraft,
// os tops do Warcraft Logs, as metas das rotações (só os números dos YAMLs) e a referência dos tops
// por boss (src/data/bench). No fim, um relatório de saúde por spec: OK, ATENÇÃO ou REVISAR. As
// marcadas REVISAR pedem mudança no que a spec é (habilidade nova ou que saiu, prioridade nova): a
// skill rotation-refresh cuida delas.
//
//   npm run refresh                    tudo, com os tops que já estão baixados
//   npm run refresh -- --tops          baixa os tops antes (credenciais: variáveis de ambiente, samples/wcl-credentials.env ou o cofre do app)
//   npm run refresh -- --tops --zone latest --fresh   raide novo: os chefes da zona mais nova do
//                                      Warcraft Logs, e os tops do raide anterior saem da referência
//                                      (a pasta vira tops-<data>, nada é apagado)
//   npm run refresh -- arcane fire     só essas specs
//   npm run refresh -- --dry           não muda YAML nem referência: só o relatório
//
// O relatório fica em samples/refresh/<data>.md (e .json).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SPECS, findSpec } from './rotation/specs.mjs';
import { refreshSimc } from './rotation/simc.mjs';
import { buildDecisionRef, compareDecisions, discoverConsumers, discoverCooldowns, povOf } from '../src/lib/decisions.ts';

const ROOT = path.join(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const named = argv.filter((a, i) => !a.startsWith('--') && !['--per-boss', '--zone'].includes(argv[i - 1]));
const DRY = flag('dry');
const exe = path.join(ROOT, 'target', 'release', process.platform === 'win32' ? 'wipe-cli.exe' : 'wipe-cli');
const topsDir = (s) => path.join(ROOT, 'samples', 'rotation', s.file, 'tops');
const yamlFile = (s) => path.join(ROOT, 'rotations', `${s.file}.yaml`);
const specs = named.length ? named.map(findSpec) : SPECS.filter((s) => fs.existsSync(yamlFile(s)));

// ---------------------------------------------------------------- limites do relatório

/** Pulls dos tops abaixo disso: pouca base. */
const MIN_TOPS = 16;
/** Os próprios tops tirando menos que isso na rotação (mediana): o YAML está exigente ou errado. */
const MIN_TOPS_SCORE = 85;
/** Dicas de decisão em mais que essa fração dos pulls dos tops (top contra os outros). */
const MAX_DECISION_FP = 0.15;
/** Habilidade fora do YAML que os tops usam: presente em tantos pulls e com essa fatia dos casts. */
const NEW_IN_PULLS = 0.6;
const NEW_SHARE_WARN = 0.03;
const NEW_SHARE_REVIEW = 0.05;
/** Meta mudou menos que isso: não mexe (evita trocar número a cada rodada). */
const MIN_CHANGE = 0.05;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] : null;
};
const round5 = (x) => Math.round(x * 20) / 20;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const ASCII = /^[ -~’]+$/;

// ---------------------------------------------------------------- dados do jogo que não são rotação

const data = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const NOT_ROTATION = new Set([
  1, 75, // Melee, Auto Shot
  ...data('defensives.json').defensives.map((d) => d.id),
  ...data('interrupts.json').interrupts.map((d) => d.id),
  ...Object.values(data('consumables.json')).flatMap((c) => c.ids ?? []),
]);
const NOT_ROTATION_NAME = /potion|healthstone|flask|phial|drums|augment rune|food|feast|elixir/i;

// ---------------------------------------------------------------- YAML da spec

/** Habilidades do YAML: id, alt_ids, opcional, árvore. E os casts ignorados. */
function readYaml(text) {
  const abilities = [];
  const block = text.match(/^abilities:\n([\s\S]*?)\n\S/m)?.[1] ?? '';
  for (const line of block.split('\n')) {
    const m = line.match(/^ {2}(\w+):\s*\{(.*)\}/);
    const id = m?.[2].match(/(?:^|[,{\s])id:\s*(\d+)/)?.[1];
    if (!m || !id) continue;
    const body = m[2];
    abilities.push({
      key: m[1],
      id: +id,
      name: (body.match(/name:\s*"([^"]+)"/)?.[1] ?? body.match(/name:\s*([^,}]+)/)?.[1] ?? m[1]).trim(),
      alt: [...(body.match(/alt_ids:\s*\[([^\]]*)\]/)?.[1].matchAll(/\d+/g) ?? [])].map((x) => +x[0]),
      optional: /optional:\s*true/.test(body),
      tree: body.match(/tree:\s*(\w+)/)?.[1] ?? null,
    });
  }
  const ignore = [...(text.match(/^ignore_casts:\s*\[([^\]]*)\]/m)?.[1].matchAll(/\d+/g) ?? [])].map((x) => +x[0]);
  return { abilities, ignore };
}

/** Acrescenta `id` em alt_ids da habilidade `key` (cria a lista se não houver). */
function addAltId(text, key, id) {
  const re = new RegExp(`^( {2}${key}:\\s*\\{)(.*)\\}`, 'm');
  return text.replace(re, (_, head, body) =>
    /alt_ids:\s*\[/.test(body) ? `${head}${body.replace(/alt_ids:\s*\[([^\]]*)\]/, (__, l) => `alt_ids: [${l.trim() ? `${l.trim()}, ` : ''}${id}]`)}}` : `${head}${body.replace(/(id:\s*\d+)/, `$1, alt_ids: [${id}]`)}}`,
  );
}

/** Acrescenta `id` em ignore_casts (cria a linha no fim se não houver). */
function addIgnore(text, id, comment) {
  if (/^ignore_casts:\s*\[/m.test(text)) return text.replace(/^ignore_casts:\s*\[([^\]]*)\]/m, (_, l) => `ignore_casts: [${l.trim() ? `${l.trim()}, ` : ''}${id}]`);
  return `${text.trimEnd()}\n\n# ${comment}\nignore_casts: [${id}]\n`;
}

/** Troca `campo: valor` dentro do bloco da checagem `id` (até a próxima checagem). */
function patchCheck(text, id, field, value) {
  const at = text.search(new RegExp(`^ {4}id: ${id}\\s*$`, 'm'));
  if (at < 0) return null;
  const next = text.slice(at).search(/\n {2}- kind:/);
  const end = next < 0 ? text.length : at + next;
  const block = text.slice(at, end);
  const re = new RegExp(`(\\n {4}${field}:\\s*)([\\d.]+)`);
  const m = block.match(re);
  if (!m) return null;
  return { old: +m[2], text: text.slice(0, at) + block.replace(re, `$1${value}`) + text.slice(end) };
}

// ---------------------------------------------------------------- motor

function build() {
  const b = spawnSync('cargo', ['build', '--release', '-q', '-p', 'wipe-core', '--bin', 'wipe-cli'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('cargo build do wipe-cli falhou');
}

/** Cada pull de cada top da spec, lido pelo motor com as rotações embutidas: { src, pull, player }. */
function topPulls(spec) {
  const out = [];
  const dir = topsDir(spec);
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir)) {
    if (!fs.existsSync(path.join(dir, d, 'report.json'))) continue;
    const env = { ...process.env };
    delete env.WIPE_ROTATIONS;
    const r = spawnSync(exe, ['wcl', path.join(dir, d), '--json'], { env, maxBuffer: 1 << 30, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`wipe-cli wcl ${d}: ${r.stderr}`);
    for (const pull of JSON.parse(r.stdout).pulls) {
      if (pull.analyzedMs < 60000) continue;
      for (const player of pull.players) if (player.specId === spec.id && player.rotation) out.push({ src: d, pull, player });
    }
  }
  return out;
}

// ---------------------------------------------------------------- uma spec

async function refreshSpec(spec) {
  const items = []; // { level: 'ok'|'atenção'|'revisar', text }
  const say = (level, text) => items.push({ level, text });
  const changes = [];

  // 1. APL do SimulationCraft
  let simc = null;
  try {
    simc = await refreshSimc(spec);
    if (simc.changed) say('revisar', `A APL do SimulationCraft mudou: entrou ${simc.added.join(', ') || 'nada'}; saiu ${simc.removed.join(', ') || 'nada'}. Conferir a prioridade.`);
  } catch (e) {
    say('atenção', `Não deu para baixar a APL do SimulationCraft (${e.message}).`);
  }

  // 2. os tops pelo motor
  const pulls = topPulls(spec);
  if (!pulls.length) {
    say('revisar', 'Sem tops baixados: rode com --tops.');
    return { spec, items, changes, n: 0 };
  }
  if (pulls.length < MIN_TOPS) say('atenção', `Só ${pulls.length} pulls de tops: pouca base.`);
  const rot = (x) => x.player.rotation;

  // nota da rotação dos próprios tops
  const score = median(pulls.map((x) => rot(x).score));
  if (score < MIN_TOPS_SCORE) say('atenção', `Os próprios tops tiram ${Math.round(score)} na rotação (mediana): o YAML está exigente ou lendo algo errado.`);

  // 3. checagens: nem os tops cumprem? e as metas (só os números)
  const rates = {};
  const titles = {};
  for (const x of pulls)
    for (const f of rot(x).findings) {
      (rates[f.id] ??= []).push(f.rate);
      titles[f.id] = f.title?.pt ?? f.id;
    }
  let text = fs.readFileSync(yamlFile(spec), 'utf8');
  for (const [id, rs] of Object.entries(rates)) {
    const med = median(rs);
    const p25 = quantile(rs, 0.25);
    const kind = text.match(new RegExp(`- kind: (\\w+)\\n {4}id: ${id}\\s*\\n`))?.[1];
    if (kind === 'proc' && med < 0.85) say('revisar', `"${titles[id]}": os tops cumprem ${pct(med)} (proc de verdade passa de 85%): gasto por outra coisa ou de propósito.`);
    if (kind === 'resource_waste' && med < 0.85) say('revisar', `"${titles[id]}": os tops cumprem ${pct(med)}.`);
    if (kind === 'dot_uptime') {
      if (med < 0.6) say('revisar', `"${titles[id]}": os tops ficam ${pct(med)} com ele.`);
      else {
        const want = clamp(round5(p25 - 0.03), 0.6, 0.95);
        const p = patchCheck(text, id, 'min_uptime', want);
        if (p && Math.abs(p.old - want) >= MIN_CHANGE - 1e-9) {
          changes.push(`${id}: min_uptime ${p.old} → ${want} (tops: mediana ${pct(med)}, p25 ${pct(p25)})`);
          text = p.text;
        }
      }
    }
    if (kind === 'cooldown') {
      if (med < 0.6) say('revisar', `"${titles[id]}": os tops usam ${pct(med)} dos possíveis.`);
      const want = clamp(round5(p25 - 0.05), 0.6, 0.85);
      const p = patchCheck(text, id, 'min_usage', want);
      if (p && Math.abs(p.old - want) >= MIN_CHANGE - 1e-9) {
        changes.push(`${id}: min_usage ${p.old} → ${want} (tops: mediana ${pct(med)}, p25 ${pct(p25)})`);
        text = p.text;
      }
    }
  }
  if (changes.length && !DRY) fs.writeFileSync(yamlFile(spec), text);

  // 4. habilidades: do YAML que os tops não usam, e as que eles usam e o YAML não tem
  let { abilities, ignore } = readYaml(text);
  const known = new Set([...abilities.flatMap((a) => [a.id, ...a.alt]), ...ignore]);
  const castCount = new Map();
  const perPull = [];
  const names = new Map();
  for (const x of pulls) {
    const total = (x.player.casts ?? []).reduce((s, c) => s + c.times.length, 0) || 1;
    const share = new Map();
    for (const c of x.player.casts ?? []) {
      castCount.set(c.spellId, (castCount.get(c.spellId) ?? 0) + c.times.length);
      share.set(c.spellId, c.times.length / total);
      // nome em inglês quando algum relatório tiver (os de outros países vêm traduzidos)
      if (!names.has(c.spellId) || (!ASCII.test(names.get(c.spellId)) && ASCII.test(c.name))) names.set(c.spellId, c.name);
    }
    perPull.push(share);
  }
  // mesmo nome de uma habilidade do YAML com outro id: o jogo trocou o id (o antigo sumiu) -> alt_ids;
  // ou é um evento a mais do mesmo botão (sai junto do antigo) -> ignore_casts
  const timesOf = (id) => pulls.map((x) => (x.player.casts ?? []).find((c) => c.spellId === id)?.times ?? []);
  for (const [id, n] of castCount) {
    if (known.has(id) || !n) continue;
    const a = abilities.find((x) => x.name.toLowerCase() === (names.get(id) ?? '').toLowerCase());
    if (!a) continue;
    const mine = [a.id, ...a.alt];
    if (!mine.some((x) => castCount.get(x))) {
      text = addAltId(text, a.key, id);
      changes.push(`${a.key}: alt_ids + ${id} (os tops castam ${a.name} com esse id, e não com o do YAML)`);
    } else {
      const theirs = timesOf(id);
      const base = mine.map(timesOf);
      let together = 0;
      let all = 0;
      theirs.forEach((ts, i) => {
        for (const t of ts) {
          all++;
          if (base.some((b) => b[i].some((u) => Math.abs(u - t) <= 100))) together++;
        }
      });
      if (all && together / all >= 0.9) {
        text = addIgnore(text, id, 'eventos a mais do mesmo botão (saem junto do cast da habilidade)');
        changes.push(`ignore_casts + ${id} (${a.name}: sai junto do cast do YAML em ${pct(together / all)} das vezes)`);
      } else continue;
    }
    known.add(id);
  }
  if (changes.length && !DRY) fs.writeFileSync(yamlFile(spec), text);
  ({ abilities, ignore } = readYaml(text));

  const trees = new Set(pulls.map((x) => rot(x).tree));
  for (const a of abilities) {
    const used = [a.id, ...a.alt].some((id) => castCount.get(id));
    if (used || a.optional) continue;
    if (a.tree && ![...trees].some((t) => t && t.toLowerCase().replace(/\W+/g, '_') === a.tree)) continue;
    say('revisar', `${a.name} (${a.id}) está no YAML e nenhum top usou: talento removido, renomeado ou id trocado.`);
  }
  for (const [id, n] of castCount) {
    if (known.has(id) || NOT_ROTATION.has(id) || NOT_ROTATION_NAME.test(names.get(id) ?? '') || !n) continue;
    const shares = perPull.map((m) => m.get(id) ?? 0);
    const present = shares.filter((s) => s > 0).length / shares.length;
    const share = median(shares.filter((s) => s > 0));
    if (present < NEW_IN_PULLS || share < NEW_SHARE_WARN) continue;
    say(share >= NEW_SHARE_REVIEW ? 'revisar' : 'atenção', `${names.get(id)} (${id}): ${pct(share)} dos casts em ${pct(present)} dos pulls dos tops e não está no YAML (talento novo, ou botão que não é rotação: ignore_casts).`);
  }

  // 5. dicas de decisão: cada top contra os outros (da mesma árvore)
  let fp = 0;
  let judged = 0;
  for (const [, group] of Object.entries(Object.groupBy(pulls, (x) => rot(x).tree ?? '?'))) {
    const povs = group.map((x) => ({ x, pov: povOf(x.pull, x.player) })).filter((g) => g.pov);
    if (povs.length < 9) continue;
    for (const g of povs) {
      const others = povs.filter((o) => o.x.src !== g.x.src).map((o) => o.pov);
      if (others.length < 8) continue;
      const ref = buildDecisionRef(others, discoverConsumers(others), discoverCooldowns(others), (_, n) => n);
      judged++;
      if (compareDecisions(g.pov, ref).length) fp++;
    }
  }
  if (judged && fp / judged > MAX_DECISION_FP) say('atenção', `Dicas de procs e cooldowns em ${pct(fp / judged)} dos pulls dos próprios tops (limite ${pct(MAX_DECISION_FP)}).`);

  return { spec, items, changes, n: pulls.length, score, decisionFp: judged ? fp / judged : null, simc };
}

// ---------------------------------------------------------------- execução

const levelOf = (r) => (r.items.some((i) => i.level === 'revisar') ? 'REVISAR' : r.items.some((i) => i.level === 'atenção') ? 'ATENÇÃO' : 'OK');

if (flag('tops')) {
  if (flag('fresh'))
    for (const s of specs) {
      const dir = topsDir(s);
      if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}-${new Date().toISOString().slice(0, 10)}`);
    }
  const t = spawnSync('node', [path.join(ROOT, 'scripts', 'rotation', 'tops-all.mjs'), '--per-boss', opt('per-boss', '4'), ...(opt('zone') ? ['--zone', opt('zone')] : []), ...specs.map((s) => s.file)], { cwd: ROOT, stdio: 'inherit' });
  if (t.status !== 0) throw new Error('download dos tops falhou');
}

// nomes dos talentos (árvore do Raidbots): o bench usa para dizer quais talentos mudam a rotação
try {
  const r = await fetch('https://www.raidbots.com/static/data/live/talents.json');
  if (r.ok) fs.writeFileSync(path.join(ROOT, 'samples', 'rotation', 'talents.json'), await r.text());
} catch {
  console.log('não deu para baixar a árvore de talentos do Raidbots: os talentos saem sem nome');
}

build();
const results = [];
for (const spec of specs) {
  process.stdout.write(`${spec.name}... `);
  const r = await refreshSpec(spec);
  results.push(r);
  console.log(`${levelOf(r)}${r.changes.length ? ` (${r.changes.length} meta(s) ajustada(s))` : ''}`);
}

// metas mudaram: o motor embute as rotações, então a referência dos tops sai com elas
if (!DRY) {
  const b = spawnSync('node', ['--experimental-strip-types', path.join(ROOT, 'scripts', 'rotation', 'bench.mjs'), ...specs.map((s) => s.file)], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('referência dos tops (bench.mjs) falhou');
}

// talentos que mudam a rotação (da referência recém-gerada)
for (const r of results) {
  const f = path.join(ROOT, 'src', 'data', 'bench', `${r.spec.file}.json`);
  if (!fs.existsSync(f)) continue;
  const builds = JSON.parse(fs.readFileSync(f, 'utf8')).builds ?? {};
  r.builds = Object.entries(builds).flatMap(([tree, bd]) => bd.talents.map((t) => `${tree}: com ${t.name}, os tops usam ${t.ability} em ${pct(t.with)} dos casts (sem ele, ${pct(t.without)})`));
}

// relatório
const day = new Date().toISOString().slice(0, 10);
// rodada parcial não sobrescreve o relatório geral do dia
const name = named.length ? `${day}-${specs.map((x) => x.file).join('_')}` : day;
const out = path.join(ROOT, 'samples', 'refresh');
fs.mkdirSync(out, { recursive: true });
const order = { REVISAR: 0, 'ATENÇÃO': 1, OK: 2 };
const sorted = [...results].sort((a, b) => order[levelOf(a)] - order[levelOf(b)] || a.spec.name.localeCompare(b.spec.name));
const md = [
  `# Refresh das rotações — ${day}${DRY ? ' (sem mudar nada)' : ''}`,
  '',
  `| Spec | Estado | Pulls dos tops | Nota dos tops | Dicas nos tops | Metas ajustadas |`,
  `|---|---|---|---|---|---|`,
  ...sorted.map((r) => `| ${r.spec.name} | ${levelOf(r)} | ${r.n} | ${r.score != null ? Math.round(r.score) : '-'} | ${pct(r.decisionFp)} | ${r.changes.length} |`),
  '',
  ...sorted.flatMap((r) =>
    r.items.length || r.changes.length || r.builds?.length
      ? [`## ${r.spec.name} — ${levelOf(r)}`, '', ...r.items.map((i) => `- **${i.level}**: ${i.text}`), ...r.changes.map((c) => `- meta: ${c}`), ...(r.builds ?? []).map((b) => `- build: ${b}`), '']
      : [],
  ),
].join('\n');
fs.writeFileSync(path.join(out, `${name}.md`), md);
fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(results.map((r) => ({ spec: r.spec.file, level: levelOf(r), n: r.n, score: r.score, decisionFp: r.decisionFp, items: r.items, changes: r.changes, simc: r.simc })), null, 2));
const count = (l) => results.filter((r) => levelOf(r) === l).length;
console.log(`\n${count('OK')} OK, ${count('ATENÇÃO')} ATENÇÃO, ${count('REVISAR')} REVISAR — relatório: ${path.relative(ROOT, path.join(out, `${name}.md`))}`);
