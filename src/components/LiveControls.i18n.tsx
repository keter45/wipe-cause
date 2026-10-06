import type { ReactNode } from 'react';
import { defineMessages } from '../i18n';

export const liveControlsMsg = defineMessages(
  {
    state: { watching: 'aguardando pull', in_combat: 'em combate', analyzing: 'analisando…', error: 'erro', stopped: 'parado' },
    startTitle: 'Acompanha o log enquanto vocês jogam e analisa cada pull assim que ele termina',
    live: 'Ao vivo',
    inCombatWith: (boss: string) => `em combate: ${boss}`,
    liveMode: 'Modo ao vivo',
    following: (what: ReactNode) => (
      <>Acompanhando {what}. Quando um pull termina, o log é reanalisado e o pull abre sozinho (e vai para o Discord, se configurado).</>
    ),
    guildOnWcl: 'a guilda no Warcraft Logs',
    analyzed: (n: number) => `${n} ${n === 1 ? 'pull analisado' : 'pulls analisados'} nesta sessão`,
    stop: 'Parar',
  },
  {
    state: { watching: 'waiting for a pull', in_combat: 'in combat', analyzing: 'analyzing…', error: 'error', stopped: 'stopped' },
    startTitle: 'Follows the log while you play and analyzes each pull as soon as it ends',
    live: 'Live',
    inCombatWith: (boss: string) => `in combat: ${boss}`,
    liveMode: 'Live mode',
    following: (what: ReactNode) => (
      <>Following {what}. When a pull ends, the log is analyzed again and the pull opens by itself (and goes to Discord, if set up).</>
    ),
    guildOnWcl: 'the guild on Warcraft Logs',
    analyzed: (n: number) => `${n} ${n === 1 ? 'pull analyzed' : 'pulls analyzed'} this session`,
    stop: 'Stop',
  },
);
