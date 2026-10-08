import { defineMessages } from '../i18n';

export const scoreMsg = defineMessages(
  {
    missedTurn: (name: string, n: number) => `${name} passou na vez (${n}×)`,
    massDeath: (time: string, min: number) => `morreu no wipe geral aos ${time} (${min}+ mortes juntas: não conta)`,
    decisiveDeath: (time: string) => `morte decisiva aos ${time}`,
    withDefensive: 'morreu com defensivo sobrando',
    tankHalf: '(tank: metade do peso)',
    alive: (pct: number, factor: number) => `vivo ${pct}% do pull (×${factor.toFixed(2).replace('.', ',')})`,
    performance: (parse: number, factor: number) => `parse ${parse} no Warcraft Logs (×${factor.toFixed(2).replace('.', ',')})`,
  },
  {
    missedTurn: (name: string, n: number) => `${name} went through on their turn (${n}×)`,
    massDeath: (time: string, min: number) => `died in the mass wipe at ${time} (${min}+ deaths together: doesn't count)`,
    decisiveDeath: (time: string) => `decisive death at ${time}`,
    withDefensive: 'died with a defensive left',
    tankHalf: '(tank: half weight)',
    alive: (pct: number, factor: number) => `alive ${pct}% of the pull (×${factor.toFixed(2)})`,
    performance: (parse: number, factor: number) => `Warcraft Logs parse ${parse} (×${factor.toFixed(2)})`,
  },
);
