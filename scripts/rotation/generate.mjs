// Monta a rotação base de uma spec (o modelo do YAML de rotations/) a partir da APL e do dump do
// SimulationCraft e do que os players castam nos logs; com a calibração (dos tops), ajusta metas e
// tira as checagens que nem os tops cumprem.

import fs from 'node:fs';
import path from 'node:path';
import { token } from './specs.mjs';
import { parseApl, heroTrees, aplUrl, CACHE } from './simc.mjs';
import { echoIds } from './logs.mjs';
import { conditionNote } from './note.mjs';

/** Ações da APL que não são a rotação (consumíveis, raciais, interrupts, controle de lista...). */
const SKIP = new Set(
  (
    'call_action_list run_action_list variable potion use_item use_items invoke_external_buff auto_attack auto_shot snapshot_stats ' +
    'summon_pet retarget_auto_attack pick_up_fragment cancel_action cancel_buff wait pool_resource apply_poison stealth shadowform ' +
    'battle_stance berserker_stance flask food augmentation arcane_intellect mark_of_the_wild battle_shout power_word_fortitude ' +
    'blessing_of_the_bronze skyfury lightning_shield earthliving_weapon windfury_weapon flametongue_weapon raise_dead ' +
    'berserking blood_fury fireblood ancestral_call arcane_torrent lights_judgment bag_of_tricks arcane_pulse haymaker rocket_barrage ' +
    'kick pummel counterspell rebuke mind_freeze wind_shear spear_hand_strike counter_shot muzzle silence solar_beam skull_bash disrupt ' +
    'quell spell_lock call_dreadstalkers_placeholder'
  ).split(/\s+/),
);
const NOT_ABILITY = new Set([1, 75]); // Melee, Auto Shot

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
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------------------------------------------------------------- tooltips do Wowhead (reserva)

const TIPS = path.join(CACHE, '..', 'tooltips');

/** Números de uma spell pelo tooltip do Wowhead, quando o dump do SimC não tem a entrada. */
export async function tooltip(id) {
  const p = path.join(TIPS, `${id}.json`);
  let j;
  if (fs.existsSync(p)) j = JSON.parse(fs.readFileSync(p, 'utf8'));
  else {
    const r = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`);
    if (!r.ok) return null;
    j = await r.json();
    fs.mkdirSync(TIPS, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(j));
  }
  const t = String(j.tooltip ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const n = (re, f = 1000) => {
    const m = t.match(re);
    return m ? Math.round(parseFloat(m[1]) * (m[2] === 'min' ? 60000 : f)) : undefined;
  };
  return {
    name: j.name,
    cooldown: n(/([\d.]+) (sec|min) (?:cooldown|recharge)/),
    charges: n(/(\d+) Charges/, 1),
    channel: /Channeled/.test(t),
    cast: n(/([\d.]+) sec cast/),
  };
}

// ---------------------------------------------------------------- árvores e listas da APL

function treeMatchers(trees) {
  return trees.map((t) => {
    const compact = t.key.replace(/_/g, '');
    const first = t.key.split('_')[0];
    return {
      ...t,
      byCond: (cond) => {
        for (const m of cond.matchAll(/(!?)hero_tree\.(\w+)/g)) if (!m[1] && [t.key, compact].includes(m[2])) return true;
        for (const m of cond.matchAll(/(!?)talent\.(\w+)/g)) if (!m[1] && t.talents.has(m[2])) return true;
        return false;
      },
      byName: (name) => name.includes(compact) || name.includes(t.key) || (first.length >= 4 && name.split('_').includes(first)),
    };
  });
}

function modeOf(cond, name) {
  if (cond) {
    if (/(active_enemies|spell_targets[.\w]*)\s*(>=\s*[2-9]|>\s*[1-9])/.test(cond)) return 'aoe';
    if (/(active_enemies|spell_targets[.\w]*)\s*(=\s*1\b|<\s*[23]\b|<=\s*1\b)/.test(cond)) return 'st';
  }
  if (name) {
    if (/aoe|cleave|multi|(^|_)mt($|_)|funnel/.test(name)) return 'aoe';
    if (/(^|_)st($|_)|single/.test(name)) return 'st';
  }
  return null;
}

/** Prioridade "achatada" de uma árvore num modo (st/aoe): [{ token, cond }]. */
function flatten(lists, trees, tree, mode) {
  const out = [];
  const otherTree = (cond, name) => {
    const hit = trees.find((t) => (cond && t.byCond(cond)) || (name && t.byName(name)));
    return hit && hit.key !== tree;
  };
  const walk = (name, depth) => {
    if (depth > 6) return;
    for (const a of lists.get(name) ?? []) {
      const cond = a.opts.if ?? '';
      if (a.action === 'call_action_list' || a.action === 'run_action_list') {
        const sub = a.opts.name;
        if (!sub || otherTree(cond, sub)) continue;
        const m = modeOf(cond, sub);
        if (m && m !== mode) continue;
        walk(sub, depth + 1);
        if (a.action === 'run_action_list') return;
        continue;
      }
      if (SKIP.has(a.action) || otherTree(cond, null)) continue;
      const m = modeOf(cond, null);
      if (m && m !== mode) continue;
      out.push({ token: a.action, cond });
    }
  };
  walk('default', 0);
  return out;
}

// ---------------------------------------------------------------- modelo

/**
 * `spec` (specs.mjs), `aplText`, `dump` (parseDump), `logs` (readLogs), `calibration` (opcional).
 * Devolve { model, notes } — `notes` explica o que foi decidido (vai para o console).
 */
export async function generate({ spec, aplText, dump, logs, calibration }) {
  const notes = [];
  const lists = parseApl(aplText);
  const trees = treeMatchers(heroTrees(dump, spec));
  if (!trees.length) trees.push({ name: 'Padrão', key: 'default', talents: new Set(), byCond: () => false, byName: () => false });
  const echoes = echoIds(logs);

  // ---- habilidades: id pelo que os players castam, números pelo dump (ou tooltip)
  const castIdsByToken = new Map();
  for (const [id, c] of Object.entries(logs.casts)) {
    if (NOT_ABILITY.has(+id)) continue;
    for (const t of new Set([token(c.name), token(c.name).replace(/_/g, '')])) {
      if (!castIdsByToken.has(t)) castIdsByToken.set(t, []);
      castIdsByToken.get(t).push(+id);
    }
  }
  for (const ids of castIdsByToken.values()) ids.sort((a, b) => logs.casts[b].count - logs.casts[a].count);
  const dumpFor = (tok) => dump.byToken.get(tok) ?? dump.byToken.get(tok.replace(/_/g, '')) ?? [];
  const abilities = new Map();
  const resolve = async (tok) => {
    if (abilities.has(tok)) return abilities.get(tok);
    const castIds = (castIdsByToken.get(tok) ?? castIdsByToken.get(tok.replace(/_/g, '')) ?? []).filter((id) => !echoes.has(id));
    const entries = dumpFor(tok);
    const usable = entries.filter((e) => !/Passive|Hidden/.test(e.flags) && (e.gcd != null || e.cooldown || e.charges || e.cast));
    const id = castIds[0] ?? usable.find((e) => e.talent)?.id ?? usable[0]?.id;
    if (!id) return abilities.set(tok, null).get(tok);
    let e = dump.byId.get(id) ?? usable[0];
    let num = e ? { cooldown: e.charges > 1 ? e.chargeCd : (e.cooldown ?? e.chargeCd), charges: e.charges, channel: e.channel, cast: e.cast, duration: e.duration } : null;
    if (!dump.byId.has(id)) num = (await tooltip(id)) ?? num;
    const a = {
      key: tok,
      id,
      alt_ids: castIds.slice(1),
      name: logs.casts[id]?.name ?? e?.name ?? tok,
      cast: castIds.length > 0,
      entry: e,
    };
    if (num?.channel && (num.duration > 0 || num.cast > 0)) a.channel_ms = num.duration > 0 ? num.duration : num.cast;
    else if (num?.cast > 0) a.cast_ms = num.cast;
    if (num?.cooldown >= 1000) a.cooldown_ms = num.cooldown;
    if (num?.charges > 1) a.charges = num.charges;
    const talent = e?.talent ?? entries.find((x) => x.talent)?.talent;
    if (talent?.kind === 'hero') a.tree = trees.find((t) => t.name === talent.tree)?.key;
    else if (talent && (talent.choice || talent.kind === 'class')) a.optional = true;
    abilities.set(tok, a);
    return a;
  };

  // ---- prioridade por árvore
  const nameOf = (tok) => abilities.get(tok)?.name ?? auraName(tok) ?? tok.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const auraIdsByToken = indexByToken(logs.auras);
  const debuffIdsByToken = indexByToken(logs.debuffs);
  function auraName(tok) {
    const id = auraIdsByToken.get(tok)?.[0] ?? debuffIdsByToken.get(tok)?.[0];
    return id ? (logs.auras[id] ?? logs.debuffs[id]).name : null;
  }
  const priority = {};
  for (const t of trees) {
    priority[t.key] = {};
    for (const mode of ['st', 'aoe']) {
      const items = [];
      const seen = new Set();
      for (const { token: tok, cond } of flatten(lists, trees, t.key, mode)) {
        const a = await resolve(tok);
        if (!a) continue;
        const note = conditionNote(cond, nameOf);
        const k = `${tok}|${note}`;
        if (seen.has(k) || items.length >= 14 || items.filter((i) => i.spell === tok).length >= 2) continue;
        seen.add(k);
        items.push({ spell: tok, note });
      }
      priority[t.key][mode] = items;
    }
  }
  // ações de todas as listas (para inferir checagens), com o pré-combate
  const allActions = [...lists.entries()].flatMap(([list, acts]) => acts.map((a) => ({ ...a, list })));
  for (const a of allActions) if (!SKIP.has(a.action) && a.action !== 'call_action_list' && a.action !== 'run_action_list') await resolve(a.action);

  // ---- marcadores das árvores: habilidade de herói castada (ou exclusiva das listas da árvore)
  const castable = [...abilities.values()].filter(Boolean);
  const heroTreesOut = trees.map((t) => {
    // casts e buffs de talento de herói da árvore que aparecem no log (ex.: Vampiric Strike, Essence of the Blood Queen)
    const heroIds = (map) =>
      Object.entries(map)
        .filter(([id, v]) => {
          const e = dump.byId.get(+id);
          return (e?.talent?.kind === "hero" && e.talent.tree === t.name) || t.talents.has(token(v.name)) || dumpFor(token(v.name)).some((x) => x.talent?.kind === "hero" && x.talent.tree === t.name);
        })
        .sort((a, b) => b[1].count - a[1].count)
        .map(([id]) => +id);
    let markers = [...castable.filter((a) => a.tree === t.key && a.cast).map((a) => a.id), ...heroIds(logs.casts), ...heroIds(logs.auras)];
    markers = [...new Set(markers)];
    if (!markers.length) {
      const mine = new Set(['st', 'aoe'].flatMap((m) => priority[t.key][m].map((i) => i.spell)));
      const others = new Set(trees.filter((o) => o !== t).flatMap((o) => ['st', 'aoe'].flatMap((m) => priority[o.key][m].map((i) => i.spell))));
      markers = [...mine].filter((s) => !others.has(s) && abilities.get(s)?.cast).map((s) => abilities.get(s).id);
    }
    return { key: t.key, name: t.name, markers: markers.slice(0, 2) };
  });
  if (heroTreesOut.length > 1 && heroTreesOut.every((t) => t.markers.length)) {
    // a árvore com menos casts exclusivos vira a "sem marcador" (padrão)
    heroTreesOut.sort((a, b) => b.markers.length - a.markers.length);
  }

  // ---- checagens
  const checks = [];
  const buffs = {};
  const used = new Set();
  const playerFights = Math.max(1, logs.players.length);

  checks.push({ kind: 'downtime', id: 'always_be_casting', gcd_ms: 1200, min_gap_ms: 800, importance: 'high', title: 'Tempo sem castar', tip: 'Sempre com um GCD rodando: no movimento, use as habilidades instantâneas.' });

  // recurso: o que os gastos da APL consomem (sem mana e runas), se aparece no log como ganho
  const spendTypes = new Map();
  for (const a of castable) {
    const r = a.entry?.resource;
    if (r && r.amount > 0 && ![0, 5].includes(r.type)) spendTypes.set(r.type, { name: r.name, n: (spendTypes.get(r.type)?.n ?? 0) + 1 });
  }
  const [rType, rInfo] = [...spendTypes.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? [];
  const energize = rType != null ? logs.energize[rType] : null;
  if (energize && energize.gain > 0) {
    // o ganho às vezes vem com outro id do mesmo nome (Demonbolt: cast 264178, ganho 280127)
    const byName = new Map(castable.map((a) => [token(a.name), a.key]));
    const ids = new Map(castable.flatMap((a) => [a.id, ...a.alt_ids].map((id) => [id, a.key])));
    for (const [id, src] of Object.entries(energize.sources)) if (!ids.has(+id) && byName.has(token(src.name))) ids.set(+id, byName.get(token(src.name)));
    const total = Object.values(energize.sources).reduce((s, x) => s + x.count, 0);
    const fromAbilities = Object.entries(energize.sources).filter(([id]) => ids.has(+id));
    const fromShare = fromAbilities.reduce((s, [, x]) => s + x.count, 0) / Math.max(1, total);
    const spenders = castable.filter((a) => a.entry?.resource?.type === rType && a.entry.resource.amount > 0).map((a) => a.name);
    const c = { kind: 'resource_waste', id: token(rInfo.name), power_type: rType, resource: rInfo.name, importance: 'high', title: `${rInfo.name} desperdiçado`, tip: `Gaste${spenders.length ? ` com ${spenders.slice(0, 2).join(' / ')}` : ''} antes de chegar ao máximo de ${rInfo.name}.` };
    if (fromShare < 0.85 && fromAbilities.length) {
      c.from = [...new Set(fromAbilities.map(([id]) => ids.get(+id)))];
      notes.push(`${rInfo.name}: ${pct(1 - fromShare)} vem de procs/passivos; só conta o dos geradores castados (from).`);
    }
    checks.push(c);
  } else if (rInfo) notes.push(`${rInfo.name} não aparece no log como ganho: sem checagem de recurso.`);

  // DoTs: dot.X / refreshable na APL e o debuff que os players põem nos inimigos
  const dots = new Set();
  for (const a of allActions) {
    const cond = a.opts.if ?? '';
    for (const m of cond.matchAll(/dot\.(\w+)\.(refreshable|ticking|remains)/g)) dots.add(m[1].replace(/_dot$/, ''));
    if (/(^|[&|(])refreshable/.test(cond)) dots.add(a.action);
  }
  for (const d of dots) {
    const id = debuffIdsByToken.get(d)?.[0];
    if (!id || logs.debuffs[id].count < playerFights) continue;
    const name = logs.debuffs[id].name;
    buffs[d] = { id, name };
    checks.push({ kind: 'dot_uptime', id: d, debuff: d, min_uptime: 0.9, importance: 'medium', title: `${name} fora do alvo`, tip: `${name} sempre no alvo: renove no pandemic.` });
  }

  // procs: buff.X.react/up na condição de uma ação que o buff modifica (Affecting Spells do dump)
  const procs = new Map();
  for (const a of allActions) {
    const ab = abilities.get(a.action);
    if (!ab) continue;
    for (const m of (a.opts.if ?? '').matchAll(/(^|[^!\w.])buff\.(\w+)\.(react|up|stack)/g)) {
      const b = m[2];
      if (abilities.get(b) || !auraIdsByToken.get(b)) continue;
      const auraId = auraIdsByToken.get(b)[0];
      const bEntries = dumpFor(b);
      const short = bEntries.some((e) => e.duration > 0 && e.duration <= 30000) || !bEntries.length;
      const affected = (x) => [x.entry, ...dumpFor(x.key)].some((e) => e?.affecting.some((f) => f.id === auraId || token(f.name) === b));
      if (!short || !affected(ab)) continue;
      if (!procs.has(b)) procs.set(b, { auraId, spenders: new Set() });
      procs.get(b).spenders.add(a.action);
      for (const other of castable) if (affected(other)) procs.get(b).spenders.add(other.key);
    }
  }
  // casts do log que o buff também modifica, mesmo fora da APL (ex.: Necrotic Coil no lugar do Death Coil)
  for (const [b, p] of procs) {
    for (const [id, c] of Object.entries(logs.casts)) {
      if (NOT_ABILITY.has(+id) || echoes.has(+id)) continue;
      const e = dump.byId.get(+id);
      if (e?.affecting.some((f) => f.id === p.auraId || token(f.name) === b)) {
        const a = await resolve(token(c.name));
        if (a) p.spenders.add(a.key);
      }
    }
  }
  for (const [b, p] of procs) {
    const name = logs.auras[p.auraId].name;
    buffs[b] = { id: p.auraId, name };
    const sp = [...p.spenders].filter((s) => abilities.get(s)?.cast);
    if (!sp.length) continue;
    checks.push({ kind: 'proc', id: b, buff: b, spenders: sp, importance: 'medium', title: `${name} perdido`, tip: `${name} melhora o próximo ${sp.map((s) => abilities.get(s).name).join(' / ')}: use antes de acabar.` });
  }

  // cooldowns: da APL, com 20s+ (ou cargas com 15s+)
  const cds = castable.filter((a) => a.cast && (a.cooldown_ms >= 20000 || (a.charges > 1 && a.cooldown_ms >= 15000)) && allActions.some((x) => x.action === a.key));
  if (cds.length) checks.push({ kind: 'cooldown', id: 'cooldowns', spells: cds.map((a) => a.key), min_usage: 0.8, importance: 'medium', title: 'Cooldown parado', tip: `${cds.slice(0, 4).map((a) => a.name).join(', ')} no cooldown.` });

  // ---- calibração pelos tops
  const removed = [];
  if (calibration) {
    const cal = calibration.checks ?? {};
    for (let i = checks.length - 1; i >= 0; i--) {
      const c = checks[i];
      const s = cal[c.id];
      if (!s?.rates?.length) continue;
      const med = median(s.rates);
      const p25 = quantile(s.rates, 0.25);
      if (c.kind === 'downtime') {
        const dt = median(calibration.downtimePct ?? []);
        if (dt != null && dt > 0.2) {
          removed.push(`tempo parado (os tops ficam ${pct(dt)} sem castar: a spec guarda recurso de propósito)`);
          checks.splice(i, 1);
        }
      } else if (c.kind === 'resource_waste') {
        if (med < 0.85) {
          removed.push(`${c.title} (os tops desperdiçam ${pct(1 - med)})`);
          checks.splice(i, 1);
        }
      } else if (c.kind === 'dot_uptime') {
        if (med < 0.6) {
          removed.push(`${c.title} (os tops ficam ${pct(med)} com ele)`);
          checks.splice(i, 1);
        } else c.min_uptime = clamp(round5(p25 - 0.03), 0.6, 0.95);
      } else if (c.kind === 'proc') {
        // proc de verdade os tops gastam quase sempre; abaixo disso é buff de janela ou gasto por outra coisa
        if (med < 0.85) {
          removed.push(`${c.title} (os tops "perdem" ${pct(1 - med)}: o buff é gasto por outra coisa ou de propósito)`);
          checks.splice(i, 1);
        }
      } else if (c.kind === 'cooldown') {
        const keep = c.spells.filter((sp) => {
          const u = calibration.cooldowns?.[abilities.get(sp).name];
          if (!u?.length) return true;
          if (median(u) < 0.6) {
            removed.push(`${abilities.get(sp).name} da checagem de cooldown (os tops usam ${pct(median(u))} dos possíveis)`);
            return false;
          }
          return true;
        });
        if (!keep.length) checks.splice(i, 1);
        else {
          c.spells = keep;
          c.min_usage = clamp(round5(p25 - 0.05), 0.6, 0.85);
        }
      }
    }
  }

  // ---- abertura: o que ≥70% dos tops castam nos primeiros 12s (sem dados: pré-combate + cooldowns)
  const opener = { window_ms: 12000, ordered: false };
  const treeOfPlayer = (p) => {
    const ids = new Set([...p.casts.map(([, id]) => id), ...p.auras]);
    return heroTreesOut.find((t) => t.markers.some((m) => ids.has(m)))?.key ?? heroTreesOut.find((t) => !t.markers.length)?.key ?? heroTreesOut[0].key;
  };
  // abertura medida em 9s nos tops e cobrada em 12s: folga para o começo do fight no WCL vs. o do encontro
  const relevant = (a) => a && (a.cooldown_ms >= 15000 || buffs[a.key]);
  for (const t of heroTreesOut) {
    const ps = logs.players.filter((p) => treeOfPlayer(p) === t.key);
    let seq = [];
    if (ps.length >= 3) {
      const first = new Map();
      for (const p of ps) {
        const seenHere = new Map();
        for (const [ms, id] of p.casts) if (ms <= 9000 && !seenHere.has(id)) seenHere.set(id, ms);
        for (const [id, ms] of seenHere) {
          const a = castable.find((x) => x.id === id || x.alt_ids.includes(id));
          if (!relevant(a)) continue;
          if (!first.has(a.key)) first.set(a.key, []);
          first.get(a.key).push(ms);
        }
      }
      seq = [...first.entries()].filter(([, v]) => v.length >= ps.length * 0.7).sort((a, b) => median(a[1]) - median(b[1])).map(([k]) => k).slice(0, 6);
    }
    if (!seq.length) {
      // sem tops dessa árvore: os cooldowns na ordem da prioridade
      seq = [...new Set(priority[t.key].st.map((i) => i.spell).filter((k) => abilities.get(k)?.cooldown_ms >= 15000 && abilities.get(k)?.cast))].slice(0, 4);
    }
    opener[t.key] = seq;
  }

  // ---- ids que aparecem como cast mas não são o player apertando (ecos e procs muito frequentes)
  const known = new Set(castable.flatMap((a) => [a.id, ...a.alt_ids]));
  const perMin = (id) => logs.casts[id].count / Math.max(1, logs.totalMs / 60000);
  const ignore = Object.keys(logs.casts)
    .map(Number)
    .filter((id) => !known.has(id) && !NOT_ABILITY.has(id) && (echoes.has(id) || (perMin(id) > 6 && dump.byId.get(id)?.gcd == null)));

  // ---- textos
  const cdNames = checks.find((c) => c.kind === 'cooldown')?.spells.map((s) => abilities.get(s).name) ?? [];
  const procNames = checks.filter((c) => c.kind === 'proc').map((c) => `${buffs[c.buff].name} (${c.spenders.map((s) => abilities.get(s).name).join(' / ')})`);
  const dotNames = checks.filter((c) => c.kind === 'dot_uptime').map((c) => buffs[c.debuff].name);
  const res = checks.find((c) => c.kind === 'resource_waste');
  const keyPoints = [
    cdNames.length && `Cooldowns no cooldown: ${cdNames.join(', ')}.`,
    dotNames.length && `Sempre no alvo: ${dotNames.join(', ')} (renove no pandemic).`,
    procNames.length && `Gaste os procs antes de acabar: ${procNames.join('; ')}.`,
    res && `Não estoure ${res.resource}.`,
    checks.some((c) => c.kind === 'downtime') && 'Sempre com um GCD rodando; no movimento, as habilidades instantâneas.',
  ].filter(Boolean);

  const usedAbilities = new Set([
    ...Object.values(priority).flatMap((m) => [...m.st, ...m.aoe].map((i) => i.spell)),
    ...checks.flatMap((c) => [...(c.spells ?? []), ...(c.spenders ?? []), ...(c.from ?? [])]),
    ...Object.entries(opener).flatMap(([k, v]) => (Array.isArray(v) ? v : [])),
  ]);
  for (const k of usedAbilities) used.add(k);
  const abilitiesOut = Object.fromEntries(
    [...used]
      .map((k) => abilities.get(k))
      .filter(Boolean)
      .sort((a, b) => (b.cooldown_ms ?? 0) - (a.cooldown_ms ?? 0))
      .map((a) => [a.key, pick(a, ['id', 'alt_ids', 'name', 'cast_ms', 'channel_ms', 'cooldown_ms', 'charges', 'tree', 'optional'])]),
  );
  for (const t of trees) for (const m of ['st', 'aoe']) priority[t.key][m] = priority[t.key][m].filter((i) => abilitiesOut[i.spell]);

  const model = {
    spec: spec.id,
    name: spec.name,
    patch: calibration?.patch ?? '12.1',
    sources: [
      { title: `SimulationCraft — APL ${spec.simc} (midnight)`, url: aplUrl(spec).replace('raw.githubusercontent.com/simulationcraft/simc/midnight', 'github.com/simulationcraft/simc/blob/midnight') },
      { title: `Wowhead — ${spec.name} Rotation Guide`, url: `https://www.wowhead.com/guide/classes/${spec.cls.replace('deathknight', 'death-knight').replace('demonhunter', 'demon-hunter')}/${spec.spec.replace(/_/g, '-')}/rotation-cooldowns-pve-dps` },
    ],
    ignore_casts: ignore,
    key_points: keyPoints,
    hero_trees: heroTreesOut,
    abilities: abilitiesOut,
    buffs,
    priority,
    opener,
    checks,
  };
  return { model, notes, removed, calibrated: !!calibration };
}

function indexByToken(map) {
  const idx = new Map();
  for (const [id, v] of Object.entries(map)) {
    for (const t of new Set([token(v.name), token(v.name).replace(/_/g, '')])) {
      if (!idx.has(t)) idx.set(t, []);
      idx.get(t).push(+id);
    }
  }
  for (const ids of idx.values()) ids.sort((a, b) => map[b].count - map[a].count);
  return idx;
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}
