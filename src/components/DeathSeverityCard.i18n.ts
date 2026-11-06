import { defineMessages } from '../i18n';

const ordinal = (n: number) => {
  const k = n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10;
  return `${n}${k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`;
};

export const deathSeverityMsg = defineMessages(
  {
    title: 'Gravidade das mortes: DPS',
    subtitle: 'O que cada um ainda tinha para usar na hora de morrer: defensivo grande, healthstone e poção.',
    legendFull: 'Tinha tudo livre',
    legendPartial: 'Tinha parte livre',
    legendUsed: 'Já tinha usado tudo',
    player: 'Jogador',
    pulls: 'Pulls',
    deaths: 'Mortes',
    how: 'Como foram as mortes',
    allFree: 'Tudo livre',
    freeOnDeath: 'Ficou livre ao morrer',
    rank: (n: number) => `${n}°`,
    barLabel: (full: number, partial: number, used: number) => `${full} com tudo livre, ${partial} com parte livre, ${used} com tudo usado`,
    healthstone: 'Healthstone livre',
    potion: 'Poção de vida livre',
    emptyDefensive: 'Nunca teve defensivo grande livre',
    freeTimes: (name: string, n: number) => `${name}: ${n}×`,
    footEvolution: (min: number, dim: number) =>
      `Entram os DPS com ${min} ou mais pulls do boss nas noites salvas, do maior para o menor % de mortes com tudo livre. Mortes depois da call de wipe e mortes de mecânica que mata a raide (5 ou mais mortes em 1,5s, ou um golpe que sempre é wipe no boss) não contam. Linhas apagadas têm menos de ${dim} mortes contadas. Os ícones mostram o que estava livre ao morrer e em quantas mortes: o defensivo grande que mais sobrou, a healthstone e a poção. O mais esquecido fica em destaque.`,
    footNight: (pct: number, dim: number) =>
      `Entram os DPS com pelo menos ${pct}% dos pulls da noite e ao menos uma morte contada, do maior para o menor % de mortes com tudo livre. Mortes depois da call de wipe e mortes de mecânica que mata a raide (5 ou mais mortes em 1,5s, ou um golpe que sempre é wipe no boss) não contam. Linhas apagadas têm menos de ${dim} mortes contadas. Os ícones mostram o que estava livre ao morrer e em quantas mortes: o defensivo grande que mais sobrou, a healthstone e a poção. O mais esquecido fica em destaque.`,
  },
  {
    title: 'Death severity: DPS',
    subtitle: 'What each player still had to use when dying: big defensive, healthstone and potion.',
    legendFull: 'Had everything free',
    legendPartial: 'Had some free',
    legendUsed: 'Had used everything',
    player: 'Player',
    pulls: 'Pulls',
    deaths: 'Deaths',
    how: 'How the deaths went',
    allFree: 'All free',
    freeOnDeath: 'Left free on death',
    rank: ordinal,
    barLabel: (full: number, partial: number, used: number) => `${full} with everything free, ${partial} with some free, ${used} with everything used`,
    healthstone: 'Healthstone free',
    potion: 'Health potion free',
    emptyDefensive: 'Never had a big defensive free',
    freeTimes: (name: string, n: number) => `${name}: ${n}×`,
    footEvolution: (min: number, dim: number) =>
      `Includes DPS with ${min} or more pulls of the boss across the saved nights, from the highest to the lowest % of deaths with everything free. Deaths after the wipe call and deaths from a raid-killing mechanic (5 or more deaths within 1.5s, or a blow that is always a wipe on the boss) do not count. Faded rows have fewer than ${dim} counted deaths. The icons show what was free on death and in how many deaths: the big defensive left over most often, the healthstone and the potion. The most forgotten one is highlighted.`,
    footNight: (pct: number, dim: number) =>
      `Includes DPS with at least ${pct}% of the night's pulls and at least one counted death, from the highest to the lowest % of deaths with everything free. Deaths after the wipe call and deaths from a raid-killing mechanic (5 or more deaths within 1.5s, or a blow that is always a wipe on the boss) do not count. Faded rows have fewer than ${dim} counted deaths. The icons show what was free on death and in how many deaths: the big defensive left over most often, the healthstone and the potion. The most forgotten one is highlighted.`,
  },
);
