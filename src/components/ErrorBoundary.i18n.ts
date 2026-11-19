import { defineMessages } from '../i18n';
import { glossary as G } from '../i18n/glossary';

export const errorMsg = defineMessages(
  {
    title: (where: string) => `Algo deu errado ${where}`,
    rest: 'O resto do app continua funcionando. Se repetir, copie os detalhes e mande para quem mantém o app.',
    retry: G.pt.retry,
    reload: 'Recarregar o app',
    copied: 'Copiado',
    copy: 'Copiar detalhes',
    close: 'Fechar',
    inApp: 'no app',
  },
  {
    title: (where: string) => `Something went wrong ${where}`,
    rest: 'The rest of the app keeps working. If it happens again, copy the details and send them to whoever maintains the app.',
    retry: G.en.retry,
    reload: 'Reload the app',
    copied: 'Copied',
    copy: 'Copy details',
    close: 'Close',
    inApp: 'in the app',
  },
);
