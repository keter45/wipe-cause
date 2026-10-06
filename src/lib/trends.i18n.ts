import { defineMessages } from '../i18n';

export const trendsMsg = defineMessages(
  {
    killAt: (night: string, pulls: number) => `Kill em ${night}, depois de ${pulls} pulls no total.`,
    bestPerNight: (list: string) => `Melhor pull por noite: ${list}.`,
    causeTrend: (name: string, a: number, first: string, b: number, last: string, better: boolean) =>
      `${name}: gatilho em ${a}% dos wipes em ${first} → ${b}% em ${last}${better ? ' (melhorou)' : ' (piorou)'}.`,
    improved: (who: string, a: number, b: number) => `${who} foi quem mais melhorou: nota ${a} → ${b}.`,
    dropped: (who: string, a: number, b: number) => `${who} caiu de nota: ${a} → ${b}.`,
    repeatDeaths: (who: string, killer: string, n: number, nights: number, withDefensive: number) =>
      `${who} morreu para ${killer} ${n}× em ${nights} noites${withDefensive ? `, ${withDefensive} delas com defensivo sobrando` : ''}.`,
  },
  {
    killAt: (night: string, pulls: number) => `Kill on ${night}, after ${pulls} pulls in total.`,
    bestPerNight: (list: string) => `Best pull per night: ${list}.`,
    causeTrend: (name: string, a: number, first: string, b: number, last: string, better: boolean) =>
      `${name}: trigger in ${a}% of wipes on ${first} → ${b}% on ${last}${better ? ' (improved)' : ' (got worse)'}.`,
    improved: (who: string, a: number, b: number) => `${who} improved the most: score ${a} → ${b}.`,
    dropped: (who: string, a: number, b: number) => `${who}'s score dropped: ${a} → ${b}.`,
    repeatDeaths: (who: string, killer: string, n: number, nights: number, withDefensive: number) =>
      `${who} died to ${killer} ${n}× over ${nights} nights${withDefensive ? `, ${withDefensive} of them with a defensive left` : ''}.`,
  },
);
