import { defineMessages } from '../i18n';

export const viewerMsg = defineMessages(
  {
    home: 'Início',
    cutoff: 'O corte de mortes é o de quem compartilhou',
    offline: 'O app de quem compartilhou está desligado agora. A página tenta de novo sozinha.',
    linkGone: 'Este link não existe mais: peça o link novo a quem compartilhou.',
    offlineStale: 'O app de quem compartilhou está desligado: o que aparece pode estar desatualizado.',
    badKey: 'link inválido ou desligado: peça o link de novo a quem compartilhou.',
    badge: 'Só para ver',
    badgeTitle: 'Link de visualização: as análises vêm do app de quem compartilhou e atualizam sozinhas. Nada pode ser mudado daqui.',
    empty: 'Nenhuma análise compartilhada ainda.',
    pickNight: 'Escolha uma noite na barra lateral.',
  },
  {
    home: 'Home',
    cutoff: 'The death cutoff is the one set by the person who shared',
    offline: "The sharer's app is off right now. The page keeps trying on its own.",
    linkGone: 'This link no longer exists: ask the person who shared it for the new link.',
    offlineStale: "The sharer's app is off: what you see may be out of date.",
    badKey: 'invalid or turned-off link: ask the person who shared it for the link again.',
    badge: 'View only',
    badgeTitle: "Viewing link: the analyses come from the sharer's app and update on their own. Nothing can be changed from here.",
    empty: 'No shared analyses yet.',
    pickNight: 'Pick a night in the sidebar.',
  },
);
