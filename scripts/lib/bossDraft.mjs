// Rascunho de regra de boss (encounters/<raide>/<boss>.yaml) a partir do Journal, do BigWigs e, se houver
// log, do `wipe-cli probe ids`. Só monta o texto: quem decide o que fica é a skill `boss-new` (REVISAR).

/** kebab-case ASCII: `Kith'ix` → `kithix`, `The Unbinding of Kith'ix` → `the-unbinding-of-kithix`. */
export function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
const snake = (t) => slug(t).replace(/-/g, '_');
const q = (s) => JSON.stringify(String(s)); // texto YAML entre aspas
const REVIEW = '{ pt: "A revisar", en: "To review" }';
const num = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
const SHAPE_PT = { sphere: 'esfera', box: 'caixa', polygon: 'polígono', cylinder: 'cilindro', disk: 'disco' };

// ───────────────────────── o que o `probe ids` confirma ─────────────────────────

const count = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : v && typeof v === 'object' ? Object.keys(v).length : v ? 1 : 0);
const pick = (e, ...names) => names.reduce((n, k) => n + count(e?.[k]), 0);

/**
 * Normaliza a saída do `wipe-cli probe ids --json` (`{ spells: [{ spellId, castStart, castSuccess,
 * auraOnPlayers, damageHits, .. }] }`) para `Map<spellId, { cast, aura, damage }>` (booleanos).
 */
export function idRoles(ids) {
  const out = new Map();
  if (!ids) return out;
  const src = ids.spells ?? ids;
  const entries = Array.isArray(src) ? src.map((e) => [e.spell_id ?? e.spellId ?? e.id, e]) : Object.entries(src);
  for (const [id, e] of entries) {
    if (!Number(id) || !e || typeof e !== 'object') continue;
    out.set(Number(id), {
      cast: pick(e, 'castStart') + pick(e, 'castSuccess') > 0,
      aura: pick(e, 'auraOnPlayers') > 0,
      damage: pick(e, 'damageHits') > 0,
    });
  }
  return out;
}

/** Papéis de cada spell nos eventos que o BigWigs loga (`self:Log`) e nas auras que ele acompanha. */
function bigwigsRoles(bw) {
  const out = new Map();
  const get = (id) => out.get(id) ?? out.set(id, { cast: false, aura: false, damage: false }).get(id);
  for (const l of bw?.logs ?? []) {
    for (const id of l.ids) {
      if (/^SPELL_CAST_(START|SUCCESS)$/.test(l.event)) get(id).cast = true;
      else if (/^SPELL_AURA_/.test(l.event)) get(id).aura = true;
      else if (/DAMAGE$/.test(l.event)) get(id).damage = true;
    }
  }
  for (const a of bw?.auras ?? []) get(a.spellId).aura = true;
  return out;
}

// ───────────────────────── fases e mecânicas ─────────────────────────

const ORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function phaseKey(title, i) {
  const m = title.match(/^(?:stage|phase)\s+(\w+)/i);
  if (m) return `p${ORD[m[1].toLowerCase()] ?? (Number(m[1]) || i + 1)}`;
  return snake(title.split(':')[0]) || `p${i + 1}`;
}

/** Uma mecânica por spell (spell repetido em várias seções vira uma só, juntando flags e dificuldades). */
function collectSpells(sections) {
  const bySpell = new Map();
  for (const s of sections) {
    if (!s.spellId) continue;
    const e = bySpell.get(s.spellId) ?? { spellId: s.spellId, title: s.title, flags: new Set(), diffs: [], plain: false, firstId: s.id };
    s.flags.forEach((f) => e.flags.add(f));
    const d = s.flags.filter((f) => f === 'heroic' || f === 'mythic');
    if (d.length) e.diffs.push(...d);
    else e.plain = true; // uma aparição sem marca de dificuldade vale para todas
    bySpell.set(s.spellId, e);
  }
  return [...bySpell.values()];
}

function gameHint(sp) {
  if (!sp) return '';
  const bits = [];
  const rad = (sp.radiusYd ?? []).filter((r) => r > 0 && r < 50);
  if (rad.length) bits.push(`raio ${rad.map(num).join('/')} jd`);
  if (sp.durationMs && sp.durationMs < 3600e3) bits.push(`dura ${num(sp.durationMs / 1000)} s`);
  if (sp.castMs) bits.push(`cast ${num(sp.castMs / 1000)} s`);
  if (sp.areaTriggerShape) bits.push(`areatrigger ${SHAPE_PT[sp.areaTriggerShape] ?? sp.areaTriggerShape}`);
  return bits.length ? `# jogo: ${bits.join(', ')} (dica; o log manda)` : '';
}

const oneLine = (t, n = 160) => String(t ?? '').replace(/\$[@\w]+|\|c\w{8}|\|r|\|H[^|]*\|h|\|h/g, '').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1').trim().slice(0, n);

/**
 * Texto YAML de uma regra nova. `journal` e `bigwigs` vêm de `bossSources`; `ids` é o JSON do
 * `wipe-cli probe ids` (ou null). `opts.date` fixa o `updated` (testes).
 */
export function draftRule({ journal, bigwigs = null, ids = null }, opts = {}) {
  const raid = slug(journal.instance?.name ?? 'raid');
  const boss = slug(journal.name);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const logRoles = idRoles(ids);
  const bwRoles = bigwigsRoles(bigwigs);
  const tankAuras = new Set((bigwigs?.auras ?? []).filter((a) => a.tank).map((a) => a.spellId));
  const L = [];

  L.push(`# RASCUNHO do \`npm run boss:new\` (${date}): tudo marcado "A revisar" precisa da skill boss-new.`);
  L.push('# O Journal e o BigWigs dão os nomes e as flags; os ids do log podem ser outros (confira com o `probe ids`).');
  L.push('schema_version: 1');
  L.push(`raid: ${raid}`);
  L.push(`boss: ${boss}`);
  L.push(`name: ${q(journal.name)}`);
  L.push(`encounter_id: ${journal.encounterId}`);
  L.push('source:');
  L.push('  - "wago.tools: Encounter Journal e tabelas de spell"');
  if (bigwigs?.file) L.push(`  - "BigWigs: ${bigwigs.file}"`);
  L.push(`updated: ${date}`);
  L.push('difficulties: [normal, heroic, mythic]');
  L.push('');

  // units: npcs do BigWigs (o primeiro é o boss) e, se o probe trouxe, as unidades vistas no log
  const unitKey = snake(journal.name) || 'boss';
  const units = [];
  const npcs = bigwigs?.npcs ?? [];
  units.push({ key: unitKey, name: journal.name, npc: npcs[0] ?? null, boss: true });
  npcs.slice(1).forEach((n) => units.push({ key: `npc_${n}`, name: `NPC ${n}`, npc: n, boss: false }));
  for (const u of ids?.units ?? []) {
    const n = Number(u.npc_id ?? u.npcId);
    if (n && !units.some((x) => x.npc === n) && u.name) units.push({ key: snake(u.name) || `npc_${n}`, name: u.name, npc: n, boss: false });
  }
  L.push('units:');
  for (const u of units) L.push(`  - { key: ${u.key}, name: ${q(u.name)}, npc_id: ${u.npc ?? 'null'}${u.boss ? ', boss: true' : ''} }`);
  if (!npcs.length) L.push('  # sem RegisterEnableMob no BigWigs: complete o npc_id com o `probe units`');
  L.push('');

  // fases: títulos "Stage"/"Intermission" do Journal; sem gatilho (a skill completa `start` e `hp`)
  const phases = journal.sections.filter((s) => !s.parentId && !s.spellId && /^(stage|phase|intermission)/i.test(s.title));
  if (phases.length) {
    L.push('# fases do Journal: complete `start` (cast ou zero) e `hp` com a skill; só a primeira abre no pull');
    L.push('phases:');
    const seen = new Set();
    phases.forEach((p, i) => {
      let key = phaseKey(p.title, i);
      while (seen.has(key)) key += '_2';
      seen.add(key);
      L.push(`  - { key: ${key}, name: ${q(p.title)}${i === 0 ? ', start: pull' : ''} }`);
    });
    L.push('');
  }

  L.push('mechanics:');
  const used = new Set();
  for (const e of collectSpells(journal.sections)) {
    const sp = journal.spells?.[e.spellId];
    const name = sp?.name ?? e.title;
    let key = snake(name) || `spell_${e.spellId}`;
    while (used.has(key)) key += '_2';
    used.add(key);

    const bw = bwRoles.get(e.spellId) ?? {};
    const lg = logRoles.get(e.spellId) ?? {};
    const role = { cast: !!(bw.cast || lg.cast), aura: !!(bw.aura || lg.aura), damage: !!(bw.damage || lg.damage) };
    const confirmed = role.cast || role.aura || role.damage;
    const interrupt = e.flags.has('interruptible');
    const tank = e.flags.has('tank') || tankAuras.has(e.spellId);
    const sev = e.flags.has('deadly') ? 'wipe' : e.flags.has('important') ? 'major' : 'minor';
    // dificuldade: aparece só em seções de heroico/mítico → lista; senão todas
    const diffs = !e.plain && e.diffs.length ? [...new Set(e.diffs)] : [];

    L.push('');
    const hint = gameHint(sp);
    if (hint) L.push(`  ${hint}`);
    if (sp?.description) L.push(`  # Journal: ${oneLine(sp.description)}`);
    L.push(`  - key: ${key}`);
    L.push(`    name: ${q(name)}`);
    L.push(`    type: ${interrupt ? 'interrupt' : 'info'}`);
    if (tank) L.push('    roles: [tank]');
    L.push(`    severity: ${sev}`);
    if (diffs.length) L.push(`    difficulty: [${diffs.join(', ')}]`);
    // ids por papel; sem papel confirmado, o id do Journal fica como cast/aura a conferir (needs_id)
    const det = [];
    if (role.cast || interrupt || !confirmed) det.push(`cast_id: ${e.spellId}`);
    if (role.aura) det.push(`aura_id: ${e.spellId}`);
    if (role.damage) det.push(`damage_ids: [${e.spellId}]`);
    L.push(`    detect: { ${det.join(', ')} }`);
    if (!confirmed || (interrupt && !role.cast)) L.push('    needs_id: true');
    L.push(`    tip: ${REVIEW}`);
    L.push(`    message: ${REVIEW}`);
  }
  return L.join('\n') + '\n';
}
