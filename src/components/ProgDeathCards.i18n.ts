import { defineMessages } from '../i18n';

const ordinal = (n: number) => {
  const k = n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10;
  return `${n}${k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th'}`;
};

export const progDeathMsg = defineMessages(
  {
    rank: (n: number) => `${n}°`,
    deathsTitle: 'Mortes que viraram wipe',
    deathsSubtitle: 'Uma das 3 primeiras mortes do pull, e o pull acabou em até 25 s depois.',
    player: 'Jogador',
    pulls: 'Pulls',
    turnedWipe: 'Viraram wipe',
    topCause: 'Causa mais comum',
    frequency: 'Frequência',
    everyN: (n: number) => `1 a cada ${n}`,
    pullsUnit: 'pulls',
    unknown: 'Desconhecida',
    decisiveFoot: (top: number, min: number) =>
      `Os ${top} com mais mortes que viraram wipe por pull, entre quem jogou ${min} pulls ou mais. Não inclui a kill, mortes de mecânica que mata a raide nem depois da call de wipe. Qualquer golpe fatal conta, inclusive melee e golpe desconhecido.`,
  },
  {
    rank: ordinal,
    deathsTitle: 'Deaths that became the wipe',
    deathsSubtitle: 'One of the first 3 deaths of the pull, and the pull ended within 25 s after it.',
    player: 'Player',
    pulls: 'Pulls',
    turnedWipe: 'Became wipe',
    topCause: 'Most common cause',
    frequency: 'Frequency',
    everyN: (n: number) => `1 in ${n}`,
    pullsUnit: 'pulls',
    unknown: 'Unknown',
    decisiveFoot: (top: number, min: number) =>
      `The ${top} with the most deaths that became the wipe per pull, among players with ${min} pulls or more. Does not include the kill, raid-killing mechanic deaths or deaths after the wipe call. Any fatal blow counts, including melee and unknown blows.`,
  },
);
