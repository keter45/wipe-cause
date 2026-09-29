import type { Pull } from '../types';

// Sem a API do Warcraft Logs não dá para saber o ID de cada fight (o WCL numera também os
// trechos de trash). O link abre o report filtrado no boss + dificuldade, e o app mostra o
// número da try como o WCL numera ("Wipe N"), contando os pulls curtos que o app descarta.

/** Código do report a partir do link (…/reports/AbCd1234EfGh5678#fight=3) ou do próprio código. */
export function reportCode(input: string): string | null {
  const s = input.trim();
  const i = s.indexOf('/reports/');
  const code = (i >= 0 ? s.slice(i + '/reports/'.length) : s).match(/^[A-Za-z0-9]+/)?.[0] ?? '';
  return code.length >= 8 ? code : null;
}

/** Dificuldade do jogo (ENCOUNTER_START) -> dificuldade do WCL. */
export const WCL_DIFFICULTY: Record<number, number> = { 17: 1, 14: 3, 15: 4, 16: 5 };

export function bossUrl(code: string, p: Pull): string {
  const params = new URLSearchParams({ boss: String(p.encounterId) });
  const diff = WCL_DIFFICULTY[p.difficultyId];
  if (diff) params.set('difficulty', String(diff));
  params.set('wipes', p.success ? '2' : '1'); // 1 = wipes, 2 = kills
  return `https://www.warcraftlogs.com/reports/${code}?${params}`;
}

/** Como a try aparece na lista do WCL. */
export function wclPullLabel(p: Pull): string {
  return p.success ? 'Kill' : `Wipe ${p.pullNumberAll}`;
}
