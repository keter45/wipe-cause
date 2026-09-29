// Escala de interrupts: o líder cola a nota do MRT/NSRT (ou escreve a escala à mão) e o app
// confere, cast a cast, de quem era a vez e quem deixou passar.
//
// Formato aceito (livre): uma linha por grupo de interrupt. A linha diz o cast (nome ou
// {spell:ID}) e os players na ordem; linhas só com nomes continuam o último cast citado.
// Mais de uma linha para o mesmo cast = um grupo por add (1ª linha = 1º add a castar).
//
//   Wail of Terror: Fulano, Ciclano, Beltrano
//   {spell:1286399} Fulano Ciclano Beltrano
//   ||cffc41e3aFulano||r ||cff0070ddCiclano||r        (cores do MRT)

import type { MechanicResult, Pull } from '../types';
import { shortName } from './format';

/** mecânica (key) -> grupos -> players (nome curto, como no raid) em ordem */
export type Assignments = Map<string, string[][]>;

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');

/** Tira cores e texturas do MRT (||cffRRGGBB, ||r, ||T...||t) e ícones {rt1}. */
function clean(line: string): string {
  return line
    .replace(/\|\|?c[0-9a-f]{8}/gi, ' ')
    .replace(/\|\|?r/gi, ' ')
    .replace(/\|\|?T[^|]*\|\|?t/gi, ' ')
    .replace(/\{(rt\d|star|circle|diamond|triangle|moon|square|cross|x|skull)\}/gi, ' ');
}

export function parseAssignments(text: string, pull: Pull): Assignments {
  const mechs = pull.mechanics.filter((m) => m.kind === 'interrupt');
  const roster = new Map(pull.players.map((p) => [norm(shortName(p.name)), shortName(p.name)]));
  const out: Assignments = new Map();
  let current: MechanicResult | null = mechs.length === 1 ? mechs[0] : null;

  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    const ids = [...line.matchAll(/\{spell:(\d+)\}/gi)].map((m) => Number(m[1]));
    const byId = mechs.find((m) => m.spellId != null && ids.includes(m.spellId));
    const byName = mechs.find((m) => norm(line).includes(norm(m.name)));
    if (byId || byName) current = (byId ?? byName)!;
    // nomes: palavras (com acentos) que são players do raid, na ordem da linha
    const names = (line.replace(/\{[^}]*\}/g, ' ').match(/[\p{L}\p{M}']+/gu) ?? [])
      .map((w) => roster.get(norm(w)))
      .filter((n): n is string => n != null);
    if (!current || names.length === 0) continue;
    const groups = out.get(current.key) ?? [];
    groups.push(names);
    out.set(current.key, groups);
  }
  return out;
}

export interface CastCheck {
  t: number;
  source: string;
  /** de quem era a vez (null = escala sem ninguém para este add) */
  assigned: string | null;
  /** quem cortou (null = passou) */
  by: string | null;
}

export interface KickerCheck {
  name: string;
  /** casts em que era a vez dele */
  turns: number;
  /** cortou na própria vez */
  kept: number;
  /** passou na vez dele */
  missed: number;
  /** cortou fora da vez (cobriu alguém) */
  covered: number;
}

/**
 * Confere uma mecânica de interrupt contra a escala. Cada add vai para um grupo (1º add a
 * castar = 1º grupo, 2º = 2º...), e a vez gira dentro do grupo a cada cast dele. Com um grupo
 * só, a vez gira por cast, mesmo que cada add cast uma vez (ondas de adds).
 */
export function checkAssignments(m: MechanicResult, groups: string[][]): { casts: CastCheck[]; kickers: KickerCheck[] } {
  const casts = [...(m.casts ?? [])].sort((a, b) => a.t - b.t);
  const sources: string[] = [];
  const turn = groups.map(() => 0);
  const checks: CastCheck[] = casts.map((c) => {
    if (!sources.includes(c.sourceGuid)) sources.push(c.sourceGuid);
    const gi = groups.length ? sources.indexOf(c.sourceGuid) % groups.length : -1;
    const group = gi >= 0 ? groups[gi] : [];
    const k = gi >= 0 ? turn[gi]++ : 0;
    return {
      t: c.t,
      source: c.source,
      assigned: group.length ? group[k % group.length] : null,
      by: c.interruptedBy ? shortName(c.interruptedBy) : null,
    };
  });

  const kickers = new Map<string, KickerCheck>();
  const get = (name: string) => {
    const k = kickers.get(name) ?? { name, turns: 0, kept: 0, missed: 0, covered: 0 };
    kickers.set(name, k);
    return k;
  };
  for (const g of groups) for (const n of g) get(n);
  for (const c of checks) {
    if (c.assigned) {
      const a = get(c.assigned);
      a.turns++;
      if (c.by === c.assigned) a.kept++;
      else if (!c.by) a.missed++;
    }
    if (c.by && c.by !== c.assigned) get(c.by).covered++;
  }
  return { casts: checks, kickers: [...kickers.values()].sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name)) };
}

// ---------------------------------------------------------------------------
// Onde fica salvo: a nota colada, por boss + dificuldade (vale para todas as noites)

const KEY = 'wipe-cause:assignments:';
const keyOf = (p: Pull) => `${KEY}${p.encounterId}:${p.difficultyId}`;

export function savedNote(p: Pull): string {
  try {
    return localStorage.getItem(keyOf(p)) ?? '';
  } catch {
    return '';
  }
}

export function saveNote(p: Pull, text: string) {
  try {
    if (text.trim()) localStorage.setItem(keyOf(p), text);
    else localStorage.removeItem(keyOf(p));
  } catch {
    /* sem storage */
  }
}

/** Escala salva deste boss, já lida contra o raid do pull. */
export const assignmentsFor = (p: Pull): Assignments => parseAssignments(savedNote(p), p);
