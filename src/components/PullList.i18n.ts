import { defineMessages } from '../i18n';

export const pullListMsg = defineMessages(
  {
    nightSummary: 'Resumo da noite',
    noRaidBoss: 'Nenhum boss de raid neste log.',
    dungeons: 'Masmorras (M+)',
    meta: (pulls: number, kill: boolean, best: string | null) => `${pulls} ${pulls === 1 ? 'pull' : 'pulls'}${kill ? ' · kill' : best != null ? ` · melhor ${best}` : ''}`,
    openSummary: (boss: string, meta: string) => `${boss} · ${meta}: abrir o resumo do boss`,
    togglePullsAria: (open: boolean, boss: string) => `${open ? 'Esconder' : 'Mostrar'} os pulls de ${boss}`,
    togglePulls: (open: boolean): string => (open ? 'Esconder os pulls' : 'Mostrar os pulls'),
    pullTitle: (n: number, result: string | null, dur: string, deaths: number) => `Pull ${n} · ${result == null ? 'kill' : `boss em ${result}`} · ${dur} · ${deaths} mortes`,
    deaths: 'mortes',
    note: (note: string) => `Anotação: ${note}`,
  },
  {
    nightSummary: 'Night summary',
    noRaidBoss: 'No raid bosses in this log.',
    dungeons: 'Dungeons (M+)',
    meta: (pulls: number, kill: boolean, best: string | null) => `${pulls} ${pulls === 1 ? 'pull' : 'pulls'}${kill ? ' · kill' : best != null ? ` · best ${best}` : ''}`,
    openSummary: (boss: string, meta: string) => `${boss} · ${meta}: open the boss summary`,
    togglePullsAria: (open: boolean, boss: string) => `${open ? 'Hide' : 'Show'} the pulls of ${boss}`,
    togglePulls: (open: boolean) => (open ? 'Hide the pulls' : 'Show the pulls'),
    pullTitle: (n: number, result: string | null, dur: string, deaths: number) => `Pull ${n} · ${result == null ? 'kill' : `boss at ${result}`} · ${dur} · ${deaths} deaths`,
    deaths: 'deaths',
    note: (note: string) => `Note: ${note}`,
  },
);
