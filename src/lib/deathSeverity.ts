// Gravidade das mortes dos DPS: o que cada um ainda tinha para usar na hora de morrer
// (defensivo grande, healthstone e poção). Cálculo puro; o card está em DeathSeverityCard.

import type { Death, Pull } from '../types';

/** Defensivos grandes (cd >= 60s e reduzem dano de verdade ou são imunidade), por spell id. */
export const BIG_DEFENSIVES: ReadonlySet<number> = new Set([
  48792, 48707, // DK
  198589, 196555, // DH
  22812, 61336, // Druid
  363916, // Evoker
  186265, 264735, // Hunter
  45438, 414658, 110959, 55342, // Mage
  115203, 122783, 122278, 122470, // Monk
  642, 498, 184662, // Paladin
  47585, // Priest
  31224, // Rogue
  108271, // Shaman
  104773, 108416, // Warlock
  118038, 184364, // Warrior
]);

/** Golpes fatais que sempre são wipe no boss (nome do killingBlow em minúsculas), por encounterId. */
export const WIPE_KILLING_BLOWS: Readonly<Record<number, readonly string[]>> = {
  // Coiled Altar
  3429: ['eternal nightfall', 'grim execution', 'unworthy'],
};

/** 5 ou mais mortes dentro desta janela (± ao redor da morte) = morte de mecânica que mata a raide. */
export const WIPE_DEATH_MIN = 5;
export const WIPE_DEATH_WINDOW_MS = 1_500;

export const HEALTHSTONE_SPELL_ID = 6262;
export const HEALTH_POTION_SPELL_ID = 1234768;

export interface SeverityRules {
  /** mínimo absoluto de pulls jogados */
  minPulls: number;
  /** fração mínima dos pulls do intervalo (0 = não usa) */
  minPullsFrac: number;
  /** menos mortes contadas que isso = linha esmaecida */
  dimBelow: number;
  /** só entra quem tem ao menos essas mortes contadas (0 = todos) */
  minDeaths: number;
}

/** Evolução: só quem tem 50+ pulls; fica esmaecido com menos de 15 mortes. */
export const EVOLUTION_RULES: SeverityRules = { minPulls: 50, minPullsFrac: 0, dimBelow: 15, minDeaths: 0 };
/** Resumo da noite: 30% dos pulls da noite; só quem morreu ao menos uma vez; esmaecido com menos de 5 mortes. */
export const NIGHT_RULES: SeverityRules = { minPulls: 0, minPullsFrac: 0.3, dimBelow: 5, minDeaths: 1 };

/** 4 = tinha tudo livre; 1 a 3 = parte; 0 = já tinha usado tudo. */
export type SeverityLevel = 0 | 1 | 2 | 3 | 4;
export type ResourceKey = 'defensive' | 'healthstone' | 'potion';

export interface FreeDefensive {
  spellId: number;
  name: string;
}

export interface SeverityRow {
  guid: string;
  name: string;
  class: string | null;
  pulls: number;
  /** mortes contadas */
  deaths: number;
  full: number;
  partial: number;
  used: number;
  /** 0..1: mortes com tudo livre / mortes contadas */
  fullPct: number;
  /** mortes contadas em que cada recurso estava livre */
  free: Record<ResourceKey, number>;
  /** defensivo grande que mais vezes estava livre (null = nunca) */
  defensive: FreeDefensive | null;
  /** recursos com o maior N (empate: todos os empatados); vazio se nada ficou livre */
  forgotten: ResourceKey[];
  hasBigKit: boolean;
  dim: boolean;
}

export interface SeverityResult {
  rows: SeverityRow[];
  totalPulls: number;
  /** pulls mínimos exigidos para entrar */
  minPulls: number;
}

/** Nível 0..4 de uma morte a partir do que estava livre. */
export function severityLevel(bigFree: boolean, healthstoneFree: boolean, potionFree: boolean, hasBigKit: boolean): SeverityLevel {
  const points = (bigFree ? 2 : 0) + (healthstoneFree ? 1 : 0) + (potionFree ? 1 : 0);
  const max = hasBigKit ? 4 : 2;
  return Math.round((4 * points) / max) as SeverityLevel;
}

/** Mortes de um pull que são wipe: 5+ mortes (de qualquer papel, mesmo ignoradas) na janela de ±1,5s. */
export function wipeDeaths(deaths: Death[], min = WIPE_DEATH_MIN, windowMs = WIPE_DEATH_WINDOW_MS): Set<Death> {
  const out = new Set<Death>();
  for (const d of deaths) {
    let near = 0;
    for (const o of deaths) if (Math.abs(o.t - d.t) <= windowMs) near++;
    if (near >= min) out.add(d);
  }
  return out;
}

const bigFreeIn = (d: Death) => d.defensivesAvailable.filter((a) => BIG_DEFENSIVES.has(a.spellId));

interface Acc {
  guid: string;
  name: string;
  class: string | null;
  pulls: number;
  deaths: Death[];
  kit: boolean;
}

export function computeDeathSeverity(pulls: Pull[], rules: SeverityRules): SeverityResult {
  const minPulls = Math.max(rules.minPulls, Math.ceil(rules.minPullsFrac * pulls.length));
  const accs = new Map<string, Acc>();
  const get = (guid: string, name: string, cls: string | null): Acc => {
    let a = accs.get(guid);
    if (!a) accs.set(guid, (a = { guid, name, class: cls, pulls: 0, deaths: [], kit: false }));
    a.class ||= cls;
    return a;
  };

  for (const p of pulls) {
    const roleOf = new Map(p.players.map((x) => [x.guid, x.role]));
    for (const x of p.players) if (x.role === 'dps') get(x.guid, x.name, x.class).pulls++;
    const wipe = wipeDeaths(p.deaths);
    const blows = WIPE_KILLING_BLOWS[p.encounterId] ?? [];
    for (const d of p.deaths) {
      if ((d.role ?? roleOf.get(d.guid)) !== 'dps') continue;
      const a = get(d.guid, d.name, d.class);
      // o kit conta qualquer morte dele no intervalo
      if (d.defensivesAvailable.some((s) => BIG_DEFENSIVES.has(s.spellId)) || d.defensivesRecent.some((s) => BIG_DEFENSIVES.has(s.spellId))) a.kit = true;
      if (d.ignored || wipe.has(d)) continue;
      const blow = d.killingBlow?.spellName.toLowerCase();
      if (blow && blows.includes(blow)) continue;
      a.deaths.push(d);
    }
  }

  const rows: SeverityRow[] = [];
  for (const a of accs.values()) {
    if (a.pulls === 0 || a.pulls < minPulls || a.deaths.length < rules.minDeaths) continue;
    const free: Record<ResourceKey, number> = { defensive: 0, healthstone: 0, potion: 0 };
    const byDef = new Map<number, { name: string; n: number }>();
    let full = 0;
    let partial = 0;
    let used = 0;
    for (const d of a.deaths) {
      const big = bigFreeIn(d);
      const hs = d.healthstoneKnown && !d.usedHealthstone;
      const pot = !d.usedHealthPotion;
      if (big.length) free.defensive++;
      if (hs) free.healthstone++;
      if (pot) free.potion++;
      for (const b of new Map(big.map((x) => [x.spellId, x])).values()) byDef.set(b.spellId, { name: b.name, n: (byDef.get(b.spellId)?.n ?? 0) + 1 });
      const lv = severityLevel(big.length > 0, hs, pot, a.kit);
      if (lv === 4) full++;
      else if (lv === 0) used++;
      else partial++;
    }
    const top = [...byDef.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
    const deaths = a.deaths.length;
    const max = Math.max(free.defensive, free.healthstone, free.potion);
    rows.push({
      guid: a.guid, name: a.name, class: a.class, pulls: a.pulls, deaths, full, partial, used,
      fullPct: deaths ? full / deaths : 0,
      free,
      defensive: top ? { spellId: top[0], name: top[1].name } : null,
      forgotten: max > 0 ? (['defensive', 'healthstone', 'potion'] as const).filter((k) => free[k] === max) : [],
      hasBigKit: a.kit,
      dim: deaths < rules.dimBelow,
    });
  }
  // quem não morreu não tem gravidade: vai para o fim
  rows.sort((x, y) => Number(y.deaths > 0) - Number(x.deaths > 0) || y.fullPct - x.fullPct || y.deaths - x.deaths || x.name.localeCompare(y.name));
  return { rows, totalPulls: pulls.length, minPulls };
}
