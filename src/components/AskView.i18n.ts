import { defineMessages } from '../i18n';

export const askMsg = defineMessages(
  {
    loading: 'Carregando…',
    setupTitle: 'Pergunte à IA sobre este pull',
    setupText: 'Escolha um provedor gratuito (Gemini, Groq, OpenRouter) ou o Ollama no seu PC.',
    setup: 'Configurar a IA',
    defaultModel: 'modelo padrão',
    contextSizeTitle: 'Tamanho aproximado do dossiê enviado a cada pergunta',
    contextSize: (k: number) => `contexto ≈ ${k} mil tokens`,
    hideDossier: 'Esconder dossiê',
    showDossier: 'Ver dossiê',
    newChat: 'Nova conversa',
    switchProvider: 'Trocar provedor',
    emptyHint: 'A IA responde só com base no dossiê deste pull: mecânicas, mortes, defensivos, posições e notas.',
    thinking: 'Analisando o pull…',
    placeholder: 'Pergunte sobre este pull… (Enter envia, Shift+Enter quebra linha)',
    ask: 'Perguntar',
    privacy: 'O dossiê (com os nomes dos players) vai para o provedor escolhido a cada pergunta. A IA pode errar: confira no log.',
    demo: (q: string) =>
      `**Modo navegador** — resposta de exemplo para: _${q}_\n\n- No app, a pergunta vai para o provedor configurado junto com o dossiê do pull.\n- Exemplo com habilidades: a **Virulent Mutation (detonação)** matou 4; ninguém usou defensivo contra Venom Rupture.\n- Use **Ver dossiê** para conferir o que a IA recebe.`,
  },
  {
    loading: 'Loading…',
    setupTitle: 'Ask the AI about this pull',
    setupText: 'Pick a free provider (Gemini, Groq, OpenRouter) or Ollama on your PC.',
    setup: 'Set up the AI',
    defaultModel: 'default model',
    contextSizeTitle: 'Approximate size of the dossier sent with every question',
    contextSize: (k: number) => `context ≈ ${k}k tokens`,
    hideDossier: 'Hide dossier',
    showDossier: 'View dossier',
    newChat: 'New conversation',
    switchProvider: 'Switch provider',
    emptyHint: 'The AI answers only from this pull’s dossier: mechanics, deaths, defensives, positions and notes.',
    thinking: 'Analyzing the pull…',
    placeholder: 'Ask about this pull… (Enter sends, Shift+Enter adds a line)',
    ask: 'Ask',
    privacy: 'The dossier (with the players’ names) goes to the chosen provider with every question. The AI can be wrong: check the log.',
    demo: (q: string) =>
      `**Browser mode** — example answer for: _${q}_\n\n- In the app, the question goes to the configured provider along with the pull dossier.\n- Example with abilities: **Virulent Mutation (detonation)** killed 4; nobody used a defensive against Venom Rupture.\n- Use **View dossier** to check what the AI receives.`,
  },
);
