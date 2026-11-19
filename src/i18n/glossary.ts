// Termos que aparecem em várias telas com o mesmo texto: cada um definido uma vez. Os arquivos
// *.i18n de cada tela apontam para cá em vez de repetir (e, com o tempo, divergir).

import { defineMessages } from './index';

export const glossary = defineMessages(
  {
    nightSummary: 'Resumo da noite',
    groupMetrics: 'Métricas do grupo',
    progressionFocus: 'Foco da progressão',
    logsFolder: 'Pasta de logs do WoW',
    latestVersion: 'Você está na versão mais recente',
    yourCharacter: 'Seu personagem',
    retry: 'Tentar de novo',
    unknownKillingBlow: 'golpe final desconhecido',
  },
  {
    nightSummary: 'Night summary',
    groupMetrics: 'Group metrics',
    progressionFocus: 'Progression focus',
    logsFolder: 'WoW logs folder',
    latestVersion: 'You are on the latest version',
    yourCharacter: 'Your character',
    retry: 'Try again',
    unknownKillingBlow: 'unknown killing blow',
  },
);
