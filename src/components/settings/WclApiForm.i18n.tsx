import type { ReactNode } from 'react';
import { defineMessages } from '../../i18n';

export const wclApiMsg = defineMessages(
  {
    continueInBrowser: 'Continue no navegador: autorize o Wipe Cause no Warcraft Logs e volte para cá.',
    connectedAs: (name: string) => `Conectado como ${name}.`,
    connectedLabel: 'Conectado como',
    signOut: 'Sair',
    signInText: 'Entre com a sua conta: o app passa a ver os reports das suas guildas (inclusive os não listados), sem precisar do log no PC.',
    waiting: 'Esperando o navegador…',
    signIn: 'Entrar com o Warcraft Logs',
    advanced: 'Avançado: usar um client próprio da API',
    autoLive: 'Ligar o ao vivo sozinho quando a guilda começar a raid (log ao vivo no Warcraft Logs)',
    connected: 'Conectado ao Warcraft Logs.',
    step1: (link: ReactNode) => (
      <>
        Entre em {link} e clique em <em>Create Client</em>.
      </>
    ),
    step2: () => (
      <>
        Qualquer nome; em <em>Redirect URL</em> use <code>http://localhost</code>. Deixe <em>Public Client</em> desmarcado.
      </>
    ),
    step3: 'Copie o client ID e o client secret para cá.',
    secretSaved: '•••••••• (cole de novo para trocar)',
    checking: 'Conferindo…',
    saveConnect: 'Salvar e conectar',
    privacy:
      'Sem login, a API só mostra reports públicos. O secret fica no cofre de credenciais do Windows e as consultas só enviam boss, spec e código de report: nada do seu log sai do PC.',
  },
  {
    continueInBrowser: 'Continue in the browser: authorize Wipe Cause on Warcraft Logs and come back here.',
    connectedAs: (name: string) => `Connected as ${name}.`,
    connectedLabel: 'Connected as',
    signOut: 'Sign out',
    signInText: "Sign in with your account: the app gets to see your guilds' reports (including unlisted ones), without needing the log on your PC.",
    waiting: 'Waiting for the browser…',
    signIn: 'Sign in with Warcraft Logs',
    advanced: 'Advanced: use your own API client',
    autoLive: 'Turn live on by itself when the guild starts the raid (live log on Warcraft Logs)',
    connected: 'Connected to Warcraft Logs.',
    step1: (link: ReactNode) => (
      <>
        Go to {link} and click <em>Create Client</em>.
      </>
    ),
    step2: () => (
      <>
        Any name; for <em>Redirect URL</em> use <code>http://localhost</code>. Leave <em>Public Client</em> unchecked.
      </>
    ),
    step3: 'Copy the client ID and client secret here.',
    secretSaved: '•••••••• (paste again to change it)',
    checking: 'Checking…',
    saveConnect: 'Save and connect',
    privacy:
      "Without signing in, the API only shows public reports. The secret stays in the Windows credential vault and queries only send the boss, spec and report code: nothing from your log leaves the PC.",
  },
);
