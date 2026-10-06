import type { ReactNode } from 'react';
import { CloudDownload, Radio } from 'lucide-react';
import { defineMessages } from '../../i18n';

const wclIcon = <CloudDownload size={14} strokeWidth={1.75} className="wcl-mark" aria-hidden />;
const liveIcon = <Radio size={14} strokeWidth={1.75} aria-hidden />;

export const firstStepsMsg = defineMessages(
  {
    see: 'Ver',
    configure: 'Configurar',
    logsTitle: 'Pasta de logs do WoW',
    logsText: (dir: ReactNode) => <>O app lê o combat log que o WoW grava no seu PC ({dir}). Normalmente é encontrada sozinha.</>,
    gameTitle: 'No jogo: ligar o combat log',
    how: 'Como',
    gameText: () => (
      <>
        Em <em>Opções → Rede</em>, ligue o <em>Advanced Combat Logging</em>. Antes do primeiro pull da noite, digite <code>/combatlog</code> (ou use o uploader do Warcraft
        Logs, que liga sozinho).
      </>
    ),
    wclTitle: 'Entrar com o Warcraft Logs (recomendado)',
    signIn: 'Entrar',
    connectedAs: (name: string) => (
      <>
        Conectado como <strong>{name}</strong>.{' '}
      </>
    ),
    wclText:
      'Com a sua conta, o app vê os logs da sua guilda: mostra o que faltou no log do seu PC, liga o ao vivo sozinho quando a raid começa e traz o parse de cada um. Não precisa criar chave nem client.',
    optionalTitle: 'Opcional',
    seeOptions: 'Ver opções',
    optionalText: 'Ligar o ao vivo sozinho quando o WoW abrir, vídeos do Warcraft Recorder, aviso no Discord a cada pull e perguntas à IA.',
    dailyTitle: 'No dia a dia',
    daily: () => (
      <>
        <li>
          <strong>Nova análise</strong>: cada noite aparece numa linha, com os bosses. <em>Analisar</em> usa o log do seu PC — rápido e sem baixar nada.
        </li>
        <li>
          {wclIcon} marca bosses e pulls que <strong>não estão no seu log</strong> mas estão no Warcraft Logs (você saiu antes, entrou depois, estava longe).{' '}
          <em>Completar</em> baixa só o que falta; demora alguns minutos, então é você quem decide. Depois do primeiro download, reabrir é rápido.
        </li>
        <li>
          {liveIcon} <strong>Ao vivo</strong>: durante a raid, cada pull é analisado assim que termina. Com o WoW aberto neste PC, usa o seu log; sem ele, segue o log
          ao vivo da guilda no Warcraft Logs (alguém precisa estar com o <em>Live Logging</em> do uploader ligado).
        </li>
        <li>Masmorras (M+) ficam de fora: o app é para raid.</li>
      </>
    ),
    howItWorks: 'Como funciona',
    firstSteps: 'Primeiros passos',
    intro: 'Três coisas e você está pronto. Tudo fica salvo só neste PC.',
    missingLogs: 'Falta a pasta de logs do WoW',
    start: 'Começar: escolher uma noite',
  },
  {
    see: 'View',
    configure: 'Set up',
    logsTitle: 'WoW logs folder',
    logsText: (dir: ReactNode) => <>The app reads the combat log WoW writes on your PC ({dir}). It's usually found automatically.</>,
    gameTitle: 'In game: turn on the combat log',
    how: 'How',
    gameText: () => (
      <>
        In <em>Options → Network</em>, turn on <em>Advanced Combat Logging</em>. Before the night's first pull, type <code>/combatlog</code> (or use the Warcraft Logs
        uploader, which turns it on by itself).
      </>
    ),
    wclTitle: 'Sign in with Warcraft Logs (recommended)',
    signIn: 'Sign in',
    connectedAs: (name: string) => (
      <>
        Connected as <strong>{name}</strong>.{' '}
      </>
    ),
    wclText:
      "With your account, the app sees your guild's logs: it shows what's missing from your PC's log, turns live on by itself when the raid starts and brings everyone's parse. No key or client to create.",
    optionalTitle: 'Optional',
    seeOptions: 'See options',
    optionalText: 'Turn live on by itself when WoW opens, Warcraft Recorder videos, a Discord post on every pull and questions to the AI.',
    dailyTitle: 'Day to day',
    daily: () => (
      <>
        <li>
          <strong>New analysis</strong>: each night shows up on one line, with its bosses. <em>Analyze</em> uses your PC's log — fast and with no download.
        </li>
        <li>
          {wclIcon} marks bosses and pulls that <strong>aren't in your log</strong> but are on Warcraft Logs (you left early, joined late, were away).{' '}
          <em>Complete</em> downloads only what's missing; it takes a few minutes, so you decide. After the first download, reopening is fast.
        </li>
        <li>
          {liveIcon} <strong>Live</strong>: during the raid, each pull is analyzed as soon as it ends. With WoW open on this PC, it uses your log; without it, it
          follows the guild's live log on Warcraft Logs (someone needs the uploader's <em>Live Logging</em> on).
        </li>
        <li>Dungeons (M+) are left out: the app is for raids.</li>
      </>
    ),
    howItWorks: 'How it works',
    firstSteps: 'First steps',
    intro: "Three things and you're ready. Everything is saved only on this PC.",
    missingLogs: 'The WoW logs folder is missing',
    start: 'Start: pick a night',
  },
);
