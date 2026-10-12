import { defineMessages } from '../i18n';

export const wclTopsMsg = defineMessages(
  {
    appOnly: 'Comparar com os top players do Warcraft Logs funciona no app instalado.',
    ctaTitle: 'Compare com os top players da spec',
    ctaText: 'Conecte o Warcraft Logs (grátis, uma vez só) para ver a rotação, os cooldowns e o setup de quem tem o melhor parse neste boss.',
    connect: 'Conectar',
    noParses: 'Nenhum parse desta spec neste boss e dificuldade no Warcraft Logs ainda.',
    searching: 'Buscando os tops da spec no Warcraft Logs…',
    searchAgain: 'buscar de novo',
    changeClient: 'trocar client',
    compSearching: 'Buscando no Warcraft Logs kills de outras guildas com composição de healers parecida…',
    compNone: (checked: number) => `Nenhum dos ${checked} logs conferidos tem pelo menos 70% da nossa composição de healers.`,
    compFound: (n: number, checked: number, ours: string) => `${n} de ${checked} logs conferidos com composição parecida com a nossa (${ours}).`,
    who: { you: 'Você', ref: 'Referência', both: 'Lado a lado', profile: 'Perfil' },
    site: {
      raiderio: (name: string) => `Raider.IO (${name})`,
      wcl: (name: string) => `Warcraft Logs (${name})`,
    },
  },
  {
    appOnly: 'Comparing with the top Warcraft Logs players works in the installed app.',
    ctaTitle: "Compare with the spec's top players",
    ctaText: 'Connect Warcraft Logs (free, just once) to see the rotation, cooldowns and setup of whoever has the best parse on this boss.',
    connect: 'Connect',
    noParses: 'No parses for this spec on this boss and difficulty on Warcraft Logs yet.',
    searching: "Searching Warcraft Logs for the spec's tops…",
    searchAgain: 'search again',
    changeClient: 'change client',
    compSearching: 'Searching Warcraft Logs for kills from other guilds with a similar healer composition…',
    compNone: (checked: number) => `None of the ${checked} logs checked has at least 70% of our healer composition.`,
    compFound: (n: number, checked: number, ours: string) => `${n} of ${checked} logs checked with a composition similar to ours (${ours}).`,
    who: { you: 'You', ref: 'Reference', both: 'Side by side', profile: 'Profile' },
    site: {
      raiderio: (name: string) => `Raider.IO (${name})`,
      wcl: (name: string) => `Warcraft Logs (${name})`,
    },
  },
);
