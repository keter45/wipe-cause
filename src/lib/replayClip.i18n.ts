import { defineMessages } from '../i18n';

/** Segundos até o erro (negativo antes dele), com uma casa. */
const secs = (ms: number, comma: boolean) => {
  const s = (ms / 1000).toFixed(1);
  return `${comma ? s.replace('.', ',') : s} s`;
};

export const clipLibMsg = defineMessages(
  {
    /** o que foi cada momento do resumo */
    kind: {
      trigger: 'Causa do wipe',
      mistake: 'Falha gravíssima',
    },
    /** quadro de abertura do resumo */
    recap: 'Resumo da try',
    at: (time: string) => `em ${time}`,
    toMoment: (ms: number) => secs(ms, true),
  },
  {
    kind: {
      trigger: 'Wipe cause',
      mistake: 'Wipe-level failure',
    },
    recap: 'Try recap',
    at: (time: string) => `at ${time}`,
    toMoment: (ms: number) => secs(ms, false),
  },
);
