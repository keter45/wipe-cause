import { defineMessages } from '../i18n';

export const playersMsg = defineMessages(
  {
    columns: { name: 'Jogador', score: 'Nota', parse: 'Parse WCL', dps: 'DPS', hps: 'HPS', damageTaken: 'Dano tomado', deaths: 'Mortes', defensives: 'Defensivos' },
    parseTitle: 'Parse do Warcraft Logs no ranking do papel: DPS para dps e tanks, HPS para healers',
    wclError: (msg: string) => `Warcraft Logs: ${msg}`,
    historyNote: (empty: boolean) => (
      <>
        O Warcraft Logs só ranqueia kills: num wipe, “Parse WCL” mostra a <strong>mediana</strong> de cada player neste boss (histórico), no ranking do papel dele
        (DPS ou HPS).
        {empty && ' Ninguém tem kill registrado neste boss no Warcraft Logs ainda.'}
      </>
    ),
    historyTitle: (metric: string, median: string, best: string, kills: number) =>
      `Histórico no boss (${metric}): mediana ${median} · melhor ${best} · ${kills} ${kills === 1 ? 'kill' : 'kills'}`,
    median: 'med',
    killTitle: (metric: string, overall: string, bracket: string, rank: string) => `Parse de ${metric} neste kill: ${overall} geral · ${bracket} na faixa de item level${rank}`,
    ownTitle: (prev: number, day: string, avg: number, kills: number) => `Kill anterior dele aqui: ${prev} (${day}) · média de ${kills} kill${kills > 1 ? 's' : ''} anterior${kills > 1 ? 'es' : ''}: ${avg}`,
    firstKill: 'Primeiro kill dele aqui com parse salvo no app',
    rank: (rank: number, total: number) => ` · #${rank} de ${total}`,
    noDeductions: 'Sem descontos',
    takenByAbility: 'Dano tomado por habilidade',
    defensives: 'Defensivos',
    none: 'Nenhum.',
  },
  {
    columns: { name: 'Player', score: 'Score', parse: 'WCL parse', dps: 'DPS', hps: 'HPS', damageTaken: 'Damage taken', deaths: 'Deaths', defensives: 'Defensives' },
    parseTitle: "Warcraft Logs parse in the role's ranking: DPS for dps and tanks, HPS for healers",
    wclError: (msg: string) => `Warcraft Logs: ${msg}`,
    historyNote: (empty: boolean) => (
      <>
        Warcraft Logs only ranks kills: on a wipe, “WCL parse” shows each player's <strong>median</strong> on this boss (history), in their role's ranking (DPS or
        HPS).
        {empty && ' Nobody has a kill on this boss on Warcraft Logs yet.'}
      </>
    ),
    historyTitle: (metric: string, median: string, best: string, kills: number) =>
      `History on the boss (${metric}): median ${median} · best ${best} · ${kills} ${kills === 1 ? 'kill' : 'kills'}`,
    median: 'med',
    killTitle: (metric: string, overall: string, bracket: string, rank: string) => `${metric} parse on this kill: ${overall} overall · ${bracket} in the item level bracket${rank}`,
    ownTitle: (prev: number, day: string, avg: number, kills: number) => `Their previous kill here: ${prev} (${day}) · average of ${kills} previous kill${kills > 1 ? 's' : ''}: ${avg}`,
    firstKill: 'Their first kill here with a parse saved in the app',
    rank: (rank: number, total: number) => ` · #${rank} of ${total}`,
    noDeductions: 'No deductions',
    takenByAbility: 'Damage taken by ability',
    defensives: 'Defensives',
    none: 'None.',
  },
);
