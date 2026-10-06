import { defineMessages } from '../../i18n';

export const folderMsg = defineMessages(
  {
    appOnly: 'Escolher pastas funciona só no app instalado.',
    chosen: 'escolhida por você',
    detected: (from: string) => `detectada (${from})`,
    none: (from: string | null) => `Nenhuma pasta definida${from ? `, e a ${from} não foi encontrada neste PC` : ''}.`,
    path: 'Caminho da pasta',
    browse: 'Procurar…',
    useDetected: 'Usar a detectada',
    save: 'Salvar',
  },
  {
    appOnly: 'Choosing folders only works in the installed app.',
    chosen: 'chosen by you',
    detected: (from: string) => `detected (${from})`,
    none: (from: string | null) => `No folder set${from ? `, and the ${from} wasn't found on this PC` : ''}.`,
    path: 'Folder path',
    browse: 'Browse…',
    useDetected: 'Use the detected one',
    save: 'Save',
  },
);
