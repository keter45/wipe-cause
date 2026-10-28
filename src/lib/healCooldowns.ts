// Tabela dos CDs de cura e de redução de dano que a análise da note de CDs julga
// (data/heal-cooldowns.json; regras em docs/heal-cd-note.md). O núcleo lê o mesmo arquivo.

import file from '../../data/heal-cooldowns.json';

export type HealCdKind = 'heal' | 'mitigation';
export type HealCdEffect = 'burst' | 'sustained' | 'active';

export interface HealCd {
  id: number;
  name: string;
  class: string;
  /** specs que têm o CD; sem `kind`, a entrada só guarda `alt_ids` para o timing */
  specs?: number[];
  talent?: boolean;
  alt_ids?: number[];
  kind?: HealCdKind;
  effect?: HealCdEffect;
  duration_ms?: number;
  cooldown_ms?: number;
  heal_ids?: number[];
}

const table = (file as { cooldowns: HealCd[] }).cooldowns;
const byId = new Map<number, HealCd>();
for (const cd of table) for (const id of [cd.id, ...(cd.alt_ids ?? [])]) byId.set(id, cd);

export const healCooldowns = (): readonly HealCd[] => table;

/** A entrada da tabela de um spell (pelo id ou por um id alternativo). */
export const healCd = (spellId: number): HealCd | undefined => byId.get(spellId);

/** O id e os alternativos do mesmo botão. */
export function castIdsOf(spellId: number): number[] {
  const cd = byId.get(spellId);
  return cd ? [cd.id, ...(cd.alt_ids ?? [])] : [spellId];
}
