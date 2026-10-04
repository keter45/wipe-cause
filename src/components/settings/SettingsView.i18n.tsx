import { defineMessages } from '../../i18n';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const settingsMsg = defineMessages(
  {
    title: 'Configurações',
    intro: 'O essencial para analisar os logs e as integrações que você pode ligar quando quiser. Tudo fica salvo só neste PC.',
    language: 'Idioma',
    logsMissing: 'Falta a pasta de logs',
    essentialReady: 'Essencial pronto',
    integrationsOn: (done: number, total: number) => (
      <>
        <span className="tabular">
          {done} de {total}
        </span>{' '}
        integrações ligadas
      </>
    ),
    logsFound: (n: number) => `${n} combat log${n === 1 ? '' : 's'} na pasta`,
    videosFound: (n: number) => `${n} ${plural(n, 'vídeo de encontro encontrado', 'vídeos de encontros encontrados')}`,
    groups: {
      essential: 'Essencial',
      essentialHint: 'Sem isso não há o que analisar.',
      startup: 'Abrir com o WoW',
      analysis: 'Análise',
      integrations: 'Integrações',
      integrationsHint: 'Opcionais: cada uma liga um recurso a mais.',
      about: 'Sobre',
    },
    logs: {
      title: 'Pasta de logs do WoW',
      desc: 'Onde o jogo grava os WoWCombatLog*.txt. A lista de “Nova análise” e o modo ao vivo leem daqui.',
      missing: 'Falta configurar',
      detected: 'Detectada',
      configured: 'Configurada',
      pickTitle: 'Pasta de logs do WoW (World of Warcraft\\_retail_\\Logs)',
      detectedLabel: 'instalação do WoW',
    },
    game: {
      title: 'Combat log no jogo',
      desc: 'O WoW só grava o log quando você pede, e os detalhes dependem do Advanced Combat Logging.',
      on: 'Ligado no log aberto',
      off: 'Desligado no log aberto',
      check: 'Confira no jogo',
      step1: () => (
        <>
          No jogo: <em>Opções → Rede → Advanced Combat Logging</em> ligado (uma vez só). Sem ele, HP, recap das mortes e posições ficam incompletos.
        </>
      ),
      step2: () => (
        <>
          Antes do primeiro pull da noite, digite <code>/combatlog</code> no chat (ou use um addon que liga sozinho na raid).
        </>
      ),
      step3: 'O log vai para a pasta acima; depois é só abrir em “Nova análise” ou ligar o modo ao vivo.',
    },
    startup: {
      title: 'Ao vivo quando o WoW abrir',
      desc: 'Abriu o jogo, o Wipe Cause abre na bandeja e já acompanha a raid — sem precisar lembrar de ligar.',
    },
    on: 'Ligado',
    off: 'Desligado',
    cutoff: {
      title: 'Corte de mortes',
      desc: 'Depois de algumas mortes o wipe já está decidido: dano, cura, erros e interrupts param de contar na N-ésima morte.',
      label: (n: number) => (n === 0 ? 'Desligado' : `Após ${n} morte${n > 1 ? 's' : ''}`),
      stepper: 'Padrão para logs novos. 0 = conta tudo.',
      note: 'Vale para os próximos logs. Para mudar só o log aberto, use o contador no topo (ele reanalisa na hora).',
    },
    wcl: {
      desc: 'Abre as noites da guilda sem o log no PC, compara você com os top players da spec e mostra o parse de cada um.',
      connectedAs: (name: string) => `Conectado: ${name}`,
      connected: 'Conectado',
      notConnected: 'Não conectado',
    },
    videos: {
      title: 'Vídeos do Warcraft Recorder',
      desc: 'Assista ao gatilho do wipe e a cada morte no vídeo do Warcraft Recorder — o seu e, com a nuvem, o de quem mais da guilda subiu.',
      folderFound: 'Pasta encontrada',
      cloud: (guild: string) => `Nuvem: ${guild}`,
      noFolder: 'Sem pasta',
      pickTitle: 'Pasta de vídeos do Warcraft Recorder',
      detectedLabel: 'pasta do Warcraft Recorder',
    },
    discord: {
      desc: 'Manda o resumo de cada pull para o canal da raid, sozinho no modo ao vivo ou pelo botão “Discord”.',
    },
    ai: {
      title: 'Perguntar à IA',
      desc: 'Tire dúvidas sobre o pull com um provedor gratuito (ou local). A IA recebe um dossiê da luta.',
      configured: 'Configurada',
      notConfigured: 'Não configurada',
    },
    about: {
      desc: 'Versão, atualizações e a pasta das regras de boss.',
      available: (v: string) => `v${v} disponível`,
      browser: 'modo navegador',
      checking: 'Procurando…',
      latest: 'Você está na versão mais recente',
      availableLong: (v: string) => `Versão ${v} disponível: instale pela faixa no topo`,
      downloading: 'Baixando atualização…',
      version: 'Versão',
      browserDev: 'modo navegador (desenvolvimento)',
      check: 'Procurar atualizações',
      rules: 'Regras de boss',
      rulesNote: () => (
        <>
          Arquivos <code>.yaml</code> nesta pasta substituem as regras embutidas (mecânicas, dicas e quem deveria fazer o quê).
        </>
      ),
      reveal: 'Mostrar no Explorador',
    },
    onlyInApp: 'Configurar integrações funciona só no app instalado (no navegador a UI é só de exemplo).',
  },
  {
    title: 'Settings',
    intro: 'What you need to analyze logs, plus integrations you can turn on whenever you want. Everything is saved only on this PC.',
    language: 'Language',
    logsMissing: 'Logs folder missing',
    essentialReady: 'Essentials ready',
    integrationsOn: (done: number, total: number) => (
      <>
        <span className="tabular">
          {done} of {total}
        </span>{' '}
        integrations on
      </>
    ),
    logsFound: (n: number) => `${n} combat log${n === 1 ? '' : 's'} in the folder`,
    videosFound: (n: number) => `${n} encounter video${n === 1 ? '' : 's'} found`,
    groups: {
      essential: 'Essentials',
      essentialHint: 'Without this there is nothing to analyze.',
      startup: 'Open with WoW',
      analysis: 'Analysis',
      integrations: 'Integrations',
      integrationsHint: 'Optional: each one turns on an extra feature.',
      about: 'About',
    },
    logs: {
      title: 'WoW logs folder',
      desc: 'Where the game writes the WoWCombatLog*.txt files. The “New analysis” list and live mode read from here.',
      missing: 'Not set up',
      detected: 'Detected',
      configured: 'Configured',
      pickTitle: 'WoW logs folder (World of Warcraft\\_retail_\\Logs)',
      detectedLabel: 'WoW installation',
    },
    game: {
      title: 'Combat log in game',
      desc: 'WoW only writes the log when you ask, and the details depend on Advanced Combat Logging.',
      on: 'On in the open log',
      off: 'Off in the open log',
      check: 'Check in game',
      step1: () => (
        <>
          In game: turn on <em>Options → Network → Advanced Combat Logging</em> (once). Without it, HP, death recaps and positions are incomplete.
        </>
      ),
      step2: () => (
        <>
          Before the first pull of the night, type <code>/combatlog</code> in chat (or use an addon that turns it on in raids).
        </>
      ),
      step3: 'The log goes to the folder above; then just open it in “New analysis” or turn on live mode.',
    },
    startup: {
      title: 'Live when WoW opens',
      desc: 'Open the game and Wipe Cause opens in the tray, already following the raid — no need to remember to turn it on.',
    },
    on: 'On',
    off: 'Off',
    cutoff: {
      title: 'Death cutoff',
      desc: 'After a few deaths the wipe is already decided: damage, healing, mistakes and interrupts stop counting at the Nth death.',
      label: (n: number) => (n === 0 ? 'Off' : `After ${n} death${n > 1 ? 's' : ''}`),
      stepper: 'Default for new logs. 0 = count everything.',
      note: 'Applies to the next logs. To change only the open log, use the counter at the top (it re-analyzes right away).',
    },
    wcl: {
      desc: 'Opens the guild’s nights without the log on this PC, compares you with the spec’s top players and shows everyone’s parse.',
      connectedAs: (name: string) => `Connected: ${name}`,
      connected: 'Connected',
      notConnected: 'Not connected',
    },
    videos: {
      title: 'Warcraft Recorder videos',
      desc: 'Watch the wipe trigger and every death in the Warcraft Recorder video — yours and, with the cloud, whoever else in the guild uploaded.',
      folderFound: 'Folder found',
      cloud: (guild: string) => `Cloud: ${guild}`,
      noFolder: 'No folder',
      pickTitle: 'Warcraft Recorder videos folder',
      detectedLabel: 'Warcraft Recorder folder',
    },
    discord: {
      desc: 'Sends each pull’s summary to the raid channel, automatically in live mode or with the “Discord” button.',
    },
    ai: {
      title: 'Ask the AI',
      desc: 'Ask questions about the pull with a free (or local) provider. The AI receives a dossier of the fight.',
      configured: 'Configured',
      notConfigured: 'Not configured',
    },
    about: {
      desc: 'Version, updates and the boss rules folder.',
      available: (v: string) => `v${v} available`,
      browser: 'browser mode',
      checking: 'Checking…',
      latest: 'You are on the latest version',
      availableLong: (v: string) => `Version ${v} available: install it from the banner at the top`,
      downloading: 'Downloading update…',
      version: 'Version',
      browserDev: 'browser mode (development)',
      check: 'Check for updates',
      rules: 'Boss rules',
      rulesNote: () => (
        <>
          <code>.yaml</code> files in this folder replace the built-in rules (mechanics, tips and who should do what).
        </>
      ),
      reveal: 'Show in Explorer',
    },
    onlyInApp: 'Setting up integrations only works in the installed app (in the browser the UI is just an example).',
  },
);
