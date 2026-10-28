import { defineMessages } from '../i18n';

export const noteBoxMsg = defineMessages(
  {
    newVersion: 'Nova versão',
    newVersionHint: 'Clique antes de editar quando a note mudar entre as tries: a versão de agora continua julgando os pulls dela.',
    versions: 'Versões da note',
    version: (i: number) => `Versão ${i}`,
    noNight: 'sem noite',
    fromPull: 'a partir do pull',
    judges: (n: number) => (n === 1 ? 'julga 1 pull' : `julga ${n} pulls`),
    judgesNone: 'não julga nenhum pull desta noite',
  },
  {
    newVersion: 'New version',
    newVersionHint: 'Click before editing when the note changes between tries: the current version keeps judging its pulls.',
    versions: 'Note versions',
    version: (i: number) => `Version ${i}`,
    noNight: 'no night',
    fromPull: 'from pull',
    judges: (n: number) => (n === 1 ? 'judges 1 pull' : `judges ${n} pulls`),
    judgesNone: 'judges no pull of this night',
  },
);
