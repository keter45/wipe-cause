import { defineMessages } from '../../i18n';

export const uiMsg = defineMessages(
  {
    hint: 'O que é isto?',
    more: 'mais',
    less: 'menos',
    sortBy: (col: string) => `Ordenar por ${col}`,
  },
  {
    hint: 'What is this?',
    more: 'more',
    less: 'less',
    sortBy: (col: string) => `Sort by ${col}`,
  },
);
