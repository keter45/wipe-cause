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
      mistake: 'Erro grave',
      death: 'Morte do tank',
    },
    /** quadro de abertura do resumo */
    recap: 'Resumo da try',
    at: (time: string) => `em ${time}`,
    toMoment: (ms: number) => secs(ms, true),
    /** morte do tank: quem e o golpe */
    died: (who: string, spell: string | null) => (spell ? `${who} · ${spell}` : who),
  },
  {
    kind: {
      trigger: 'Wipe cause',
      mistake: 'Major mistake',
      death: 'Tank death',
    },
    recap: 'Try recap',
    at: (time: string) => `at ${time}`,
    toMoment: (ms: number) => secs(ms, false),
    died: (who: string, spell: string | null) => (spell ? `${who} · ${spell}` : who),
  },
);
