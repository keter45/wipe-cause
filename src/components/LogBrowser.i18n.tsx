import { defineMessages } from '../i18n';

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export const logsMsg = defineMessages(
  {
    browserNoFolders: 'No navegador não dá para escolher pastas: use o app.',
    pickTitle: 'Pasta de logs do WoW (World of Warcraft\\_retail_\\Logs)',
    browserMode: () => (
      <>
        Modo navegador: gere o relatório com <code>wipe-cli analyze log.txt --json</code> e abra o JSON pela barra lateral (ou use <code>?demoLogs=1</code> para ver
        esta tela).
      </>
    ),
    title: 'Escolha a noite',
    detected: '· detectada automaticamente',
    chosen: '· escolhida por você',
    noFolder: 'Pasta de logs ainda não definida.',
    guild: 'Guilda',
    wclRange: '· Warcraft Logs, últimos 30 dias',
    searching: 'buscando',
    refresh: 'Atualizar a lista',
    detectTitle: 'Voltar para a pasta do WoW detectada automaticamente',
    detect: 'Detectar',
    changeFolder: 'Trocar pasta',
    chooseFolder: 'Escolher pasta',
    openFileTitle: 'Abrir um arquivo de log de outro lugar',
    openFile: 'Abrir arquivo…',
    error: (e: string) => `Erro: ${e}`,
    readingLogs: (k: number) => `lendo os encontros de ${n(k, 'log', 'logs')}…`,
    setupText: (example: string) => (
      <>
        Escolha a pasta <code>Logs</code> da instalação do WoW, por exemplo <code>{example}</code>. Os logs aparecem aqui, com os bosses de cada noite.
      </>
    ),
    chooseLogsFolder: 'Escolher pasta de logs',
    readingEncounters: 'lendo encontros…',
    noRaidBosses: 'sem bosses de raid',
    onlyWclTitle: 'Só no Warcraft Logs: não está no log do seu PC',
    missingTitle: (k: number) => `${n(k, 'pull', 'pulls')} só no Warcraft Logs`,
    needsDownload: 'precisa baixar',
    pulls: (k: number) => n(k, 'pull', 'pulls'),
    plusWcl: (k: number) => ` · +${k} no WCL`,
    dungeons: (k: number) => n(k, 'chefe de masmorra (M+)', 'chefes de masmorra (M+)'),
    notOnPc: 'não está no seu PC',
    wclReports: (k: number) => `Warcraft Logs: ${n(k, 'report', 'reports')}`,
    from: (list: string) => ` de ${list}`,
    gap: (bosses: number, pulls: number) =>
      `O log do seu PC não tem ${bosses > 0 ? `${n(bosses, 'boss', 'bosses')} (${n(pulls, 'pull', 'pulls')})` : n(pulls, 'pull', 'pulls')} desta noite: estão no Warcraft Logs.`,
    confirm: (pulls: number, min: number, local: boolean) =>
      `Baixar ${n(pulls, 'pull', 'pulls')} do Warcraft Logs — cerca de ${min} min. ${local ? 'O resto vem do log do seu PC.' : 'Esta noite não está no seu PC.'} Depois do primeiro download, reabrir é rápido.`,
    downloadAnalyze: 'Baixar e analisar',
    cancel: 'Cancelar',
    inProgress: 'em andamento',
    live: 'ao vivo',
    analyzed: 'analisado',
    analyzeTitle: 'Analisar o log do seu PC (rápido, sem baixar nada)',
    analyze: 'Analisar',
    completeTitle: 'Completar com os pulls que só estão no Warcraft Logs',
    downloadTitle: 'Baixar a noite do Warcraft Logs',
    complete: 'Completar',
    download: 'Baixar',
    filterAria: 'Filtrar as noites por boss',
    allBosses: 'Todos os bosses',
    bossNights: (k: number) => n(k, 'noite', 'noites'),
    difficultyAria: 'Dificuldade',
    allDifficulties: 'Todas',
    showing: (k: number, total: number) => `${n(k, 'noite', 'noites')} de ${total}`,
    clearFilter: 'Limpar filtro',
  },
  {
    browserNoFolders: "Folders can't be picked in the browser: use the app.",
    pickTitle: 'WoW logs folder (World of Warcraft\\_retail_\\Logs)',
    browserMode: () => (
      <>
        Browser mode: generate the report with <code>wipe-cli analyze log.txt --json</code> and open the JSON from the sidebar (or use <code>?demoLogs=1</code> to see
        this screen).
      </>
    ),
    title: 'Pick the night',
    detected: '· detected automatically',
    chosen: '· chosen by you',
    noFolder: 'Logs folder not set yet.',
    guild: 'Guild',
    wclRange: '· Warcraft Logs, last 30 days',
    searching: 'searching',
    refresh: 'Refresh the list',
    detectTitle: 'Go back to the automatically detected WoW folder',
    detect: 'Detect',
    changeFolder: 'Change folder',
    chooseFolder: 'Choose folder',
    openFileTitle: 'Open a log file from somewhere else',
    openFile: 'Open file…',
    error: (e: string) => `Error: ${e}`,
    readingLogs: (k: number) => `reading the encounters of ${n(k, 'log', 'logs')}…`,
    setupText: (example: string) => (
      <>
        Choose the <code>Logs</code> folder of your WoW installation, for example <code>{example}</code>. The logs show up here, with each night's bosses.
      </>
    ),
    chooseLogsFolder: 'Choose logs folder',
    readingEncounters: 'reading encounters…',
    noRaidBosses: 'no raid bosses',
    onlyWclTitle: "Only on Warcraft Logs: it's not in your PC's log",
    missingTitle: (k: number) => `${n(k, 'pull', 'pulls')} only on Warcraft Logs`,
    needsDownload: 'needs download',
    pulls: (k: number) => n(k, 'pull', 'pulls'),
    plusWcl: (k: number) => ` · +${k} on WCL`,
    dungeons: (k: number) => n(k, 'dungeon boss (M+)', 'dungeon bosses (M+)'),
    notOnPc: 'not on your PC',
    wclReports: (k: number) => `Warcraft Logs: ${n(k, 'report', 'reports')}`,
    from: (list: string) => ` by ${list}`,
    gap: (bosses: number, pulls: number) =>
      `Your PC's log doesn't have ${bosses > 0 ? `${n(bosses, 'boss', 'bosses')} (${n(pulls, 'pull', 'pulls')})` : n(pulls, 'pull', 'pulls')} from this night: they're on Warcraft Logs.`,
    confirm: (pulls: number, min: number, local: boolean) =>
      `Download ${n(pulls, 'pull', 'pulls')} from Warcraft Logs — about ${min} min. ${local ? 'The rest comes from your PC’s log.' : "This night isn't on your PC."} After the first download, reopening is fast.`,
    downloadAnalyze: 'Download and analyze',
    cancel: 'Cancel',
    inProgress: 'in progress',
    live: 'live',
    analyzed: 'analyzed',
    analyzeTitle: "Analyze your PC's log (fast, no download)",
    analyze: 'Analyze',
    completeTitle: 'Complete it with the pulls that are only on Warcraft Logs',
    downloadTitle: 'Download the night from Warcraft Logs',
    complete: 'Complete',
    download: 'Download',
    filterAria: 'Filter the nights by boss',
    allBosses: 'All bosses',
    bossNights: (k: number) => n(k, 'night', 'nights'),
    difficultyAria: 'Difficulty',
    allDifficulties: 'All',
    showing: (k: number, total: number) => `${n(k, 'night', 'nights')} of ${total}`,
    clearFilter: 'Clear filter',
  },
);
