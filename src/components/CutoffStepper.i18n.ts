import { defineMessages } from '../i18n';

export const cutoffMsg = defineMessages(
  {
    aria: 'Ignorar eventos após N mortes',
    analyze: 'Analisar ',
    upTo: 'até',
    less: 'Menos uma morte',
    count: 'Número de mortes',
    more: 'Mais uma morte',
    unit: (n: number): string => (n === 0 ? 'mortes (desligado)' : n === 1 ? 'morte' : 'mortes'),
  },
  {
    aria: 'Ignore events after N deaths',
    analyze: 'Analyze ',
    upTo: 'up to',
    less: 'One death less',
    count: 'Number of deaths',
    more: 'One death more',
    unit: (n: number): string => (n === 0 ? 'deaths (off)' : n === 1 ? 'death' : 'deaths'),
  },
);
