import { defineMessages } from '../i18n';

export const bossMetricsMsg = defineMessages(
  {
    noDefensiveName: 'Mortes sem pot/defensivo',
    damageWindowTip: 'Dano da raide nesse alvo dentro da janela, em cada try que chegou até ela (mais é melhor). Tries de análises antigas ficam de fora até reanalisar.',
    noDefensiveTip:
      'Mortes em que o player tinha um defensivo, poção de vida ou healthstone disponível e não usou. Mortes em wipe geral e depois da call de wipe ficam de fora.',
    potionName: 'Poção de vida',
    healthstoneName: 'Healthstone',
  },
  {
    noDefensiveName: 'Deaths without pot/defensive',
    damageWindowTip: "The raid's damage on this target within the window, in each try that got that far (more is better). Tries from old analyses are left out until reanalyzed.",
    noDefensiveTip:
      'Deaths where the player had a defensive, health potion or healthstone available and did not use it. Mass-wipe deaths and deaths after the wipe call are left out.',
    potionName: 'Health potion',
    healthstoneName: 'Healthstone',
  },
);
