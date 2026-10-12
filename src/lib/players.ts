// Classe de cada personagem do log aberto, para colorir qualquer nome citado na interface
// (tabela, frase do veredito, resposta da IA…) sem cada tela precisar receber a classe. Junto, as
// habilidades que aparecem no log (do player e do boss), para pôr o ícone ao lado do nome numa frase.

import { createContext, useContext } from 'react';
import type { Pull } from '../types';
import { shortName } from './format';

export interface PlayerClasses {
  /** guid, nome completo ("Fulano-Azralon-US") e nome curto ("Fulano") -> classe */
  byKey: Map<string, string>;
  /** nomes curtos, do maior para o menor (para achar nomes dentro de um texto) */
  names: string[];
  /** nome da habilidade, como o log escreve ("Divine Toll") -> spell */
  spells: Map<string, number>;
}

export const EMPTY_CLASSES: PlayerClasses = { byKey: new Map(), names: [], spells: new Map() };

/** Habilidades com nome curto demais ou genérico não viram ícone no meio do texto. */
const MIN_SPELL_NAME = 4;

/** Toda habilidade que o log cita: do player (casts, cura, dano, defensivos, rotação) e do boss. */
function spellNames(pulls: Pull[], players: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string | null | undefined, id: number | null | undefined) => {
    // 0/1 = ambiente/melee; nome de personagem nunca vira habilidade
    if (!name || id == null || id <= 1 || name.length < MIN_SPELL_NAME || players.has(name) || out.has(name)) return;
    out.set(name, id);
  };
  for (const p of pulls) {
    for (const m of p.mechanics) add(m.name, m.spellId);
    for (const e of p.enemySpells) add(e.name, e.spellId);
    for (const d of p.deaths) {
      add(d.killingBlow?.spellName, d.killingBlow?.spellId);
      for (const a of [...(d.debuffs ?? []), ...d.defensivesAvailable, ...d.defensivesRecent]) add(a.name, a.spellId);
    }
    for (const x of p.players) {
      for (const s of [...(x.casts ?? []), ...(x.healingBySpell ?? []), ...(x.damageBySpell ?? []), ...x.defensivesUsed]) add(s.name, s.spellId);
      const r = x.rotation;
      if (!r) continue;
      for (const c of r.cooldowns) add(c.name, c.spellId);
      for (const b of r.buffs ?? []) add(b.name, b.id);
      for (const u of r.uptimes ?? []) add(u.name, u.id);
      for (const v of [...r.prioritySt, ...r.priorityAoe]) add(v.name, v.spellId);
    }
  }
  return out;
}

export function playerClasses(pulls: Pull[]): PlayerClasses {
  const byKey = new Map<string, string>();
  for (const p of pulls)
    for (const x of p.players) {
      if (!x.class) continue;
      byKey.set(x.guid, x.class);
      byKey.set(x.name, x.class);
      byKey.set(shortName(x.name), x.class);
    }
  const names = [...new Set([...byKey.keys()].filter((k) => !k.startsWith('Player-') && !k.includes('-')))].sort((a, b) => b.length - a.length);
  return { byKey, names, spells: spellNames(pulls, new Set(names)) };
}

export const PlayerClassesContext = createContext<PlayerClasses>(EMPTY_CLASSES);

export const usePlayerClasses = () => useContext(PlayerClassesContext);

/** Classe de um personagem por guid ou nome (completo ou curto). */
export function classOf(pc: PlayerClasses, key: string | null | undefined): string | null {
  if (!key) return null;
  return pc.byKey.get(key) ?? pc.byKey.get(shortName(key)) ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex que acha, num texto, os nomes de personagem e as habilidades do log (palavra inteira, o maior
 * primeiro: "Holy Shock" antes de "Holy").
 */
export function richRegex(pc: PlayerClasses): RegExp | null {
  const all = [...pc.names, ...pc.spells.keys()].sort((a, b) => b.length - a.length);
  if (!all.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(${all.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}

/** Regex que acha os nomes de personagem do log dentro de um texto (palavra inteira). */
export function namesRegex(pc: PlayerClasses): RegExp | null {
  if (!pc.names.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(${pc.names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}
