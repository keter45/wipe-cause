import { defineMessages } from './i18n';

export const appMsg = defineMessages(
  {
    needsApp: 'No navegador não dá para ler os logs: abra o app (npm run tauri dev) ou carregue um relatório JSON pela barra lateral.',
    sentToDiscord: 'enviado ao Discord',
    demoNotes: '- Exemplo de novidade\n- Outra novidade',
    noPulls: 'Nenhum pull no log.',
    analyzing: (name: string, pct: number) => `Analisando ${name}… ${pct}%`,
    analyzingBatch: (i: number, n: number, name: string, pct: number) => `Analisando ${i} de ${n}: ${name}… ${pct}%`,
    batchFailed: (list: string) => `Não deu para analisar: ${list}`,
    title: 'Por que deu wipe?',
    intro: () => (
      <>
        Escolha o log da raid e veja o gatilho de cada wipe, as mortes e quem errou o quê. No jogo, use <code>/combatlog</code> antes do pull, com{' '}
        <em>Advanced Combat Logging</em> ligado (Opções → Rede).
      </>
    ),
    outOf: (done: number, total: number) => `${done} de ${total}`,
    integrations: 'integrações ligadas: Warcraft Logs, vídeos, Discord e IA',
    browserMode: () => (
      <>
        Modo navegador: gere o relatório com <code>wipe-cli analyze log.txt --json</code> e abra o JSON pela barra lateral.
      </>
    ),
    orHistory: 'Ou abra uma análise salva na barra lateral.',
  },
  {
    needsApp: "Logs can't be read in the browser: open the app (npm run tauri dev) or load a JSON report from the sidebar.",
    sentToDiscord: 'sent to Discord',
    demoNotes: '- Sample change\n- Another change',
    noPulls: 'No pulls in the log.',
    analyzing: (name: string, pct: number) => `Analyzing ${name}… ${pct}%`,
    analyzingBatch: (i: number, n: number, name: string, pct: number) => `Analyzing ${i} of ${n}: ${name}… ${pct}%`,
    batchFailed: (list: string) => `Couldn't analyze: ${list}`,
    title: 'Why did we wipe?',
    intro: () => (
      <>
        Pick the raid log and see the trigger of each wipe, the deaths and who failed what. In game, use <code>/combatlog</code> before the pull, with{' '}
        <em>Advanced Combat Logging</em> on (Options → Network).
      </>
    ),
    outOf: (done: number, total: number) => `${done} of ${total}`,
    integrations: 'integrations on: Warcraft Logs, videos, Discord and AI',
    browserMode: () => (
      <>
        Browser mode: generate the report with <code>wipe-cli analyze log.txt --json</code> and open the JSON from the sidebar.
      </>
    ),
    orHistory: 'Or open a saved analysis from the sidebar.',
  },
);
