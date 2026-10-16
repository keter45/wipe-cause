import { defineMessages } from '../i18n';

export const wipeCallMsg = defineMessages(
  {
    short: (possible: boolean, t: string) => `${possible ? 'possível call de wipe' : 'call de wipe'} aos ${t}`,
    detail: (possible: boolean, stopped: number, t: string, trigger: string) =>
      `${possible ? 'Possível call de wipe' : 'Call de wipe'} aos ${t}: ${stopped} players pararam de jogar juntos e morreram depois. O que veio depois não conta (mortes, erros, falhas). Antes: ${trigger}.`,
    explain: (stopped: number) => `${stopped} players pararam de jogar juntos e morreram depois: o que veio depois da call não conta (mortes, erros, falhas).`,
    tank: (name: string, spell: string | null, t: string, noRez: boolean) =>
      `o tank ${name} morreu${spell ? ` para ${spell}` : ''} aos ${t}${noRez ? ' e não voltou (sem battle rez)' : ''}`,
    mass: (spell: string, n: number, t: string) => `${spell} matou ${n} players juntos aos ${t}`,
    mechanic: (spell: string, t: string) => `${spell} aos ${t}`,
    deaths: (n: number, t: string) => `${n} mortes seguidas desde ${t}`,
    noTrigger: 'nada claro (nenhuma morte ou falha grave logo antes)',
  },
  {
    short: (possible: boolean, t: string) => `${possible ? 'possible wipe call' : 'wipe call'} at ${t}`,
    detail: (possible: boolean, stopped: number, t: string, trigger: string) =>
      `${possible ? 'Possible wipe call' : 'Wipe call'} at ${t}: ${stopped} players stopped playing together and died afterwards. What came after doesn't count (deaths, mistakes, failures). Before it: ${trigger}.`,
    explain: (stopped: number) => `${stopped} players stopped playing together and died afterwards: what came after the call doesn't count (deaths, mistakes, failures).`,
    tank: (name: string, spell: string | null, t: string, noRez: boolean) =>
      `tank ${name} died${spell ? ` to ${spell}` : ''} at ${t}${noRez ? ' and didn’t come back (no battle rez)' : ''}`,
    mass: (spell: string, n: number, t: string) => `${spell} killed ${n} players together at ${t}`,
    mechanic: (spell: string, t: string) => `${spell} at ${t}`,
    deaths: (n: number, t: string) => `${n} deaths in a row since ${t}`,
    noTrigger: 'nothing clear (no death or severe failure right before)',
  },
);
