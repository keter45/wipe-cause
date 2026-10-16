// Pulls baixados do Warcraft Logs não têm o número do reino no GUID do player: o núcleo usa
// `Player-0-<gameID>`, e o gameID é o final do GUID real (`Player-3209-0A6FE13C`). Numa noite que
// junta log do PC e WCL, ou na Evolução com noites das duas fontes, a mesma pessoa virava duas.
// Aqui o GUID sintético vira o real quando o mesmo player (mesmo final e mesmo nome) aparece no log.

import type { Pull } from '../types';

const SYNTHETIC = /^Player-0-([0-9A-F]{8})$/;

/** GUID sintético -> real, pelos players dos pulls (mesmo final do GUID e mesmo nome). */
export function realGuidMap(pulls: Pull[]): Map<string, string> {
  const real = new Map<string, string>();
  for (const p of pulls) {
    for (const pl of p.players) {
      if (SYNTHETIC.test(pl.guid)) continue;
      const tail = pl.guid.split('-').pop();
      if (tail) real.set(`${tail}|${pl.name}`, pl.guid);
    }
  }
  const out = new Map<string, string>();
  for (const p of pulls) {
    for (const pl of p.players) {
      const m = SYNTHETIC.exec(pl.guid);
      const to = m && real.get(`${m[1]}|${pl.name}`);
      if (to) out.set(pl.guid, to);
    }
  }
  return out;
}

/** Troca, no lugar, todo texto igual a um GUID do mapa (players, mortes, mecânicas, replays...). */
function replaceDeep(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = replaceDeep(v[i], map);
    return v;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = replaceDeep(o[k], map);
  }
  return v;
}

/** Une os GUIDs do WCL aos do log nos pulls (no lugar). Sem nada para unir, não mexe em nada. */
export function unifyPlayerGuids<T extends Pull[]>(pulls: T): T {
  const map = realGuidMap(pulls);
  if (map.size) replaceDeep(pulls, map);
  return pulls;
}
