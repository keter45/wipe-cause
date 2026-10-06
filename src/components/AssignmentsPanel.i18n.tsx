import type { ReactNode } from 'react';
import { defineMessages } from '../i18n';

export const assignMsg = defineMessages(
  {
    title: 'Escala de interrupts',
    close: 'Fechar',
    edit: 'Editar escala',
    paste: 'Colar escala',
    help: (example: string) => (
      <>
        Cole a nota do MRT/NSRT ou escreva uma linha por add, na ordem de quem corta: <code>{example}</code>. A escala fica salva para este boss e vale para todos
        os pulls.
      </>
    ),
    names: 'Fulano, Ciclano, Beltrano',
    names2: 'Eternål, Zé',
    add: (i: number) => `add ${i}`,
    noneRecognized: 'nenhum player do raid reconhecido',
    noRoster: (spell: ReactNode) => <>Sem escala para {spell}: cole a nota para ver de quem era a vez em cada cast.</>,
    missedTurn: 'Passou na vez de: ',
    missedOf: (name: string, missed: number, turns: number) => `${name} (${missed} de ${turns})`,
    nobodyMissed: 'Ninguém da escala deixou passar.',
    time: 'Tempo',
    turnOf: 'Vez de',
    kicked: 'Cortou',
    passed: 'passou',
    covered: ' (cobriu)',
    kicker: (name: string, kept: number, turns: number, covered: number) => `${name}: ${kept}/${turns} na vez${covered ? `, cobriu ${covered}` : ''}`,
  },
  {
    title: 'Interrupt assignments',
    close: 'Close',
    edit: 'Edit assignments',
    paste: 'Paste assignments',
    help: (example: string) => (
      <>
        Paste the MRT/NSRT note or write one line per add, in kick order: <code>{example}</code>. The assignments are saved for this boss and apply to every pull.
      </>
    ),
    names: 'Alice, Bob, Carol',
    names2: 'Eternål, Dave',
    add: (i: number) => `add ${i}`,
    noneRecognized: 'no raid player recognized',
    noRoster: (spell: ReactNode) => <>No assignments for {spell}: paste the note to see whose turn each cast was.</>,
    missedTurn: 'Missed their turn: ',
    missedOf: (name: string, missed: number, turns: number) => `${name} (${missed} of ${turns})`,
    nobodyMissed: 'Nobody on the assignments let one through.',
    time: 'Time',
    turnOf: 'Turn of',
    kicked: 'Kicked',
    passed: 'went through',
    covered: ' (covered)',
    kicker: (name: string, kept: number, turns: number, covered: number) => `${name}: ${kept}/${turns} on their turn${covered ? `, covered ${covered}` : ''}`,
  },
);
