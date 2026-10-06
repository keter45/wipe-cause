import { defineMessages } from '../i18n';

export const marksMsg = defineMessages(
  {
    majorTitle: 'Erro grave (marcado à mão)',
    minorTitle: 'Atenção (marcado à mão)',
    remove: (name: string) => `Remover marca de ${name}`,
    player: 'Jogador',
    pickPlayer: 'Jogador…',
    whatPlaceholder: 'o que errou (ex.: soakou o orb errado)',
    severity: 'Gravidade',
    major: 'Grave',
    minor: 'Atenção',
    mark: 'Marcar',
    cancel: 'Cancelar',
    markTitle: 'Para o que o log não mostra: posição, bait, escala errada',
    markError: 'Marcar erro',
  },
  {
    majorTitle: 'Severe mistake (marked by hand)',
    minorTitle: 'Warning (marked by hand)',
    remove: (name: string) => `Remove ${name}'s mark`,
    player: 'Player',
    pickPlayer: 'Player…',
    whatPlaceholder: 'what they did wrong (e.g. soaked the wrong orb)',
    severity: 'Severity',
    major: 'Severe',
    minor: 'Warning',
    mark: 'Mark',
    cancel: 'Cancel',
    markTitle: "For what the log doesn't show: positioning, baits, wrong assignments",
    markError: 'Mark mistake',
  },
);
