import { defineMessages } from '../i18n';

export const liveMsg = defineMessages(
  {
    waiting: (guild: string) => `Esperando alguém da ${guild} ligar o log ao vivo no Warcraft Logs…`,
    liveReport: (who: string) => `Report ao vivo de ${who} no Warcraft Logs`,
    searching: (guild: string) => `Procurando o report ao vivo da ${guild}…`,
  },
  {
    waiting: (guild: string) => `Waiting for someone in ${guild} to start live logging on Warcraft Logs…`,
    liveReport: (who: string) => `Live report from ${who} on Warcraft Logs`,
    searching: (guild: string) => `Looking for ${guild}'s live report…`,
  },
);
