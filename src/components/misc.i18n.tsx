// Textos de componentes pequenos (mapa de posições, gráfico do solo, atualização, início com o WoW).
import { defineMessages } from '../i18n';

export const positionMapMsg = defineMessages(
  {
    aria: 'Posições dos jogadores',
    distance: (yd: string, boss: string) => ` · ${yd} jd do ${boss}`,
    stale: (s: string) => ` (posição de ${s}s antes)`,
  },
  {
    aria: 'Player positions',
    distance: (yd: string, boss: string) => ` · ${yd} yd from ${boss}`,
    stale: (s: string) => ` (position from ${s}s earlier)`,
  },
);

export const soloChartMsg = defineMessages(
  {
    you: 'Você',
    every5s: (unit: string) => `${unit} a cada 5s`,
    aria: (unit: string, ref: string, windows: string) => `${unit} ao longo do pull: você e ${ref}. Trechos destacados: ${windows}.`,
    range: (a: string, b: string) => `${a} a ${b}`,
  },
  {
    you: 'You',
    every5s: (unit: string) => `${unit} every 5s`,
    aria: (unit: string, ref: string, windows: string) => `${unit} over the pull: you and ${ref}. Highlighted stretches: ${windows}.`,
    range: (a: string, b: string) => `${a} to ${b}`,
  },
);

export const updateMsg = defineMessages(
  {
    failed: (msg: string) => `Não foi possível atualizar: ${msg}`,
    close: 'Fechar',
    downloading: (version: string, pct: string) => (
      <>
        Baixando a versão <strong>{version}</strong>
        {pct}. O app reinicia sozinho ao terminar.
      </>
    ),
    available: (version: string) => (
      <>
        Nova versão <strong>{version}</strong> disponível.
      </>
    ),
    hideNotes: 'Esconder novidades',
    showNotes: 'Ver novidades',
    install: 'Atualizar e reiniciar',
    later: 'Depois',
  },
  {
    failed: (msg: string) => `Couldn't update: ${msg}`,
    close: 'Close',
    downloading: (version: string, pct: string) => (
      <>
        Downloading version <strong>{version}</strong>
        {pct}. The app restarts by itself when it's done.
      </>
    ),
    available: (version: string) => (
      <>
        New version <strong>{version}</strong> available.
      </>
    ),
    hideNotes: 'Hide changes',
    showNotes: "See what's new",
    install: 'Update and restart',
    later: 'Later',
  },
);

export const startupMsg = defineMessages(
  {
    label: 'Ligar o ao vivo quando o WoW abrir',
    text: () => (
      <>
        Mesmo com o app fechado: quando o <code>Wow.exe</code> abre, o Wipe Cause abre minimizado na bandeja (perto do relógio) e liga o modo ao vivo, sem abrir a
        janela. Para isso, um vigia leve (sem janela) inicia com o Windows e só olha se o WoW abriu.
      </>
    ),
  },
  {
    label: 'Turn live on when WoW opens',
    text: () => (
      <>
        Even with the app closed: when <code>Wow.exe</code> opens, Wipe Cause opens minimized in the tray (near the clock) and turns live mode on, without opening the
        window. For that, a light watcher (no window) starts with Windows and only checks whether WoW opened.
      </>
    ),
  },
);
