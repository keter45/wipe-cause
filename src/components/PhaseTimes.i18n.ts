import { defineMessages } from '../i18n';

export const phaseMsg = defineMessages(
  {
    ordinal: (i: number) => `${i}ª`,
    pullHead: (good: string, slow: string) => `tempo da fase · bom até ${good}, lenta acima de ${slow}`,
    rowAria: (n: string, label: string) => `${n} vez: ${label}`,
    goodTime: (s: string) => `tempo bom: ${s}`,
    slowAbove: (s: string) => `lenta acima de ${s}`,
    wipeInPhase: 'wipe na fase',
    deathsInPhase: (n: number) => `${n} mortes na fase`,
    deaths: (n: number) => `${n} ${n === 1 ? 'morte' : 'mortes'}`,
    onTime: 'no tempo',
    slow: 'lenta',
    nightHead: (good: string, slow: string) => `tempo de cada vez, pull a pull · bom até ${good}, lenta acima de ${slow}`,
    nightAvg: (s: string) => ` · média da noite ${s}s`,
    avg: 'Média',
    cellDeaths: (n: number) => `${n} ${n === 1 ? 'morte' : 'mortes'} na fase`,
    bestOfNight: 'melhor da noite',
    legend:
      'Verde no tempo bom, amarelo entre o bom e o máximo, vermelho lenta · ★ melhor da noite em cada vez · † mortes dentro da fase (3 ou mais = a mecânica deu errado, fica fora da média).',
  },
  {
    ordinal: (i: number) => `#${i}`,
    pullHead: (good: string, slow: string) => `phase time · good up to ${good}, slow above ${slow}`,
    rowAria: (n: string, label: string) => `${n}: ${label}`,
    goodTime: (s: string) => `good time: ${s}`,
    slowAbove: (s: string) => `slow above ${s}`,
    wipeInPhase: 'wipe in the phase',
    deathsInPhase: (n: number) => `${n} deaths in the phase`,
    deaths: (n: number) => `${n} ${n === 1 ? 'death' : 'deaths'}`,
    onTime: 'on time',
    slow: 'slow',
    nightHead: (good: string, slow: string) => `time of each one, pull by pull · good up to ${good}, slow above ${slow}`,
    nightAvg: (s: string) => ` · night average ${s}s`,
    avg: 'Average',
    cellDeaths: (n: number) => `${n} ${n === 1 ? 'death' : 'deaths'} in the phase`,
    bestOfNight: 'best of the night',
    legend:
      'Green within the good time, yellow between good and max, red slow · ★ best of the night for each one · † deaths inside the phase (3 or more = the mechanic went wrong, left out of the average).',
  },
);
