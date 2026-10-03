// Dados do SimulationCraft (branch midnight): a APL da spec e o dump de spells da classe.
// Ficam em cache em samples/rotation/simc/ (fora do git).

import fs from 'node:fs';
import path from 'node:path';
import { token } from './specs.mjs';

const RAW = 'https://raw.githubusercontent.com/simulationcraft/simc/midnight';
export const CACHE = path.join(import.meta.dirname, '..', '..', 'samples', 'rotation', 'simc');

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const text = await r.text();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return text;
}

export const aplUrl = (spec) => `${RAW}/ActionPriorityLists/default/${spec.simc}.simc`;
export const loadApl = (spec) => cached(aplUrl(spec), `${spec.simc}.simc`);
export const loadDump = (spec) => cached(`${RAW}/SpellDataDump/${spec.cls}.txt`, `dump-${spec.cls}.txt`);

// ---------------------------------------------------------------- APL

/**
 * `actions.lista+=/acao,if=...` -> Map(lista -> [{ action, opts }]); a lista padrão é "default".
 * As opções são separadas por vírgula (as expressões do SimC não usam vírgula).
 */
export function parseApl(text) {
  const lists = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^actions(?:\.([\w]+))?\+?=\/?(.+)$/);
    if (!m) continue;
    const list = m[1] ?? 'default';
    const [action, ...rest] = m[2].split(',');
    const opts = {};
    for (const o of rest) {
      const i = o.indexOf('=');
      if (i > 0) opts[o.slice(0, i)] = o.slice(i + 1);
    }
    if (!lists.has(list)) lists.set(list, []);
    lists.get(list).push({ action: action.trim(), opts });
  }
  return lists;
}

// ---------------------------------------------------------------- dump de spells

const secs = (v) => {
  const m = String(v).match(/([\d.]+)\s*(seconds?|minutes?|ms)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round(m[2].startsWith('minute') ? n * 60000 : m[2] === 'ms' ? n : n * 1000);
};

/**
 * Entradas do SpellDataDump: { id, name, flags, gcd, cooldown, charges, chargeCd, cast, duration,
 * channel, resource: { amount, name, type }, affecting: [{ id, name }], talent: { tree, kind, specs } }.
 */
export function parseDump(text) {
  const byId = new Map();
  const byToken = new Map();
  let cur = null;
  let key = null;
  const finish = () => {
    if (!cur) return;
    byId.set(cur.id, cur);
    for (const t of new Set([token(cur.name), token(cur.name).replace(/_/g, '')])) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(cur);
    }
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    const head = line.match(/^Name\s+: (.+?)(?: \(desc=[^)]*\))? \(id=(\d+)\)(?: \[(.*)\])?\s*$/);
    if (head) {
      finish();
      cur = { id: +head[2], name: head[1], flags: head[3] ?? '', affecting: [], attrs: '' };
      key = null;
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^([A-Z][\w ]*?)\s*: (.*)$/);
    if (kv) key = kv[1].trim();
    const value = kv ? kv[2] : line.trim();
    if (!kv && !/^\s/.test(line)) continue;
    switch (key) {
      case 'GCD':
        cur.gcd = secs(value);
        break;
      case 'Cooldown':
        cur.cooldown = secs(value);
        break;
      case 'Charges': {
        const c = value.match(/^(\d+) \(([\d.]+ \w+) cooldown\)/);
        if (c) {
          cur.charges = +c[1];
          cur.chargeCd = secs(c[2]);
        }
        break;
      }
      case 'Cast Time':
        cur.cast = secs(value);
        break;
      case 'Duration':
        cur.duration = /infinite/.test(value) ? -1 : secs(value);
        break;
      case 'Stacks':
        cur.maxStacks = +(value.match(/(\d+) maximum/)?.[1] ?? 1);
        break;
      case 'Attributes':
        cur.attrs += value + ' ';
        break;
      case 'Resource': {
        const r = value.match(/^(-?[\d.]+)%? ([A-Za-z ]+?) \((\d+)\)/);
        if (r && !cur.resource) cur.resource = { amount: parseFloat(r[1]), name: r[2], type: +r[3] };
        break;
      }
      case 'Affecting Spells':
        for (const a of value.matchAll(/([^,(]+?) \((\d+) effect/g)) cur.affecting.push({ id: +a[2], name: a[1].trim() });
        break;
      case 'Talent Entry': {
        const t = value.match(/^(.+?)(?: \(([^)]*)\))? \[(?:[^\]]*?)tree=(\w+)/);
        if (t && kv) cur.talent = { tree: t[1], specs: (t[2] ?? '').split(/, /).filter(Boolean), kind: t[3], choice: /select_idx/.test(value) };
        break;
      }
    }
  }
  finish();
  for (const e of byId.values()) e.channel = /Is Channelled/.test(e.attrs);
  return { byId, byToken };
}

/** Árvores de herói da spec, pelos talentos do dump: [{ name, key, talents: Set(token) }]. */
export function heroTrees(dump, spec) {
  const trees = new Map();
  for (const e of dump.byId.values()) {
    const t = e.talent;
    if (t?.kind !== 'hero' || !t.specs.includes(spec.specLabel)) continue;
    if (!trees.has(t.tree)) trees.set(t.tree, { name: t.tree, key: token(t.tree), talents: new Set() });
    trees.get(t.tree).talents.add(token(e.name));
    trees.get(t.tree).talents.add(token(e.name).replace(/_/g, ''));
  }
  return [...trees.values()];
}
