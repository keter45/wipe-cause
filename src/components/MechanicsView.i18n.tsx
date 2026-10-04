import { defineMessages } from '../i18n';

export const mechMsg = defineMessages(
  {
    severity: { wipe: 'Causa', major: 'Grave', minor: 'Atenção', none: 'Info' } as Record<string, string>,
    tune: 'Ajustar regras deste boss',
    noRules: (boss: string) => (
      <>
        Ainda não há regras para <strong>{boss}</strong>. Gere com a skill <code>boss-rules</code> a partir de um guia e dos spell IDs da aba “Habilidades do boss”.
      </>
    ),
    yourAdjustments: 'Regras com ajustes seus.',
    cutoff: (t: string) => `Contando só até a morte que fechou o corte (${t}); o que veio depois é ignorado.`,
    noFailures: 'Nenhuma falha de mecânica detectada neste pull.',
    clean: (list: string) => `Sem falhas: ${list}`,
    notEvaluated: (list: string) => `Ainda não avaliadas automaticamente: ${list}`,
    rulesFile: (file: string) => `Regras: ${file}`,
    focus: 'Foco da progressão',
    focusMark: 'Foco',
    yourRule: 'sua regra',
    adjusted: 'ajustada',
    adjustedTitle: (fields: string) => `Ajustado: ${fields}`,
    howToAvoid: (tip: string) => `Como evitar: ${tip}`,
    stacks: (n: number) => `${n} stacks`,
    firstTime: (t: string) => `1ª vez ${t}`,
    dispels: 'Dispels: ',
    noDispel: 'sem dispel',
    interrupted: 'Cortaram: ',
    dispelled: 'Dispelaram: ',
    helped: 'Ajudaram: ',
    positionsAt: 'Posições na falha:',
    culpritRing: 'Anel laranja: quem carregava o que explodiu.',
    whereAtFailure: 'Onde cada um estava no instante da falha.',
    watchVideo: 'ver no vídeo',
    mapHint: 'Anéis a cada 10 jardas do boss. A orientação pode não bater com a do jogo; as distâncias batem.',
    timeline: (show: boolean, n: number) => `${show ? 'Esconder' : 'Ver'} linha do tempo (${n})`,
  },
  {
    severity: { wipe: 'Cause', major: 'Severe', minor: 'Warning', none: 'Info' } as Record<string, string>,
    tune: "Adjust this boss's rules",
    noRules: (boss: string) => (
      <>
        There are no rules for <strong>{boss}</strong> yet. Generate them with the <code>boss-rules</code> skill from a guide and the spell IDs in the “Boss abilities” tab.
      </>
    ),
    yourAdjustments: 'Rules with your adjustments.',
    cutoff: (t: string) => `Counting only up to the death that closed the cutoff (${t}); what came after is ignored.`,
    noFailures: 'No mechanic failures detected in this pull.',
    clean: (list: string) => `No failures: ${list}`,
    notEvaluated: (list: string) => `Not evaluated automatically yet: ${list}`,
    rulesFile: (file: string) => `Rules: ${file}`,
    focus: 'Progression focus',
    focusMark: 'Focus',
    yourRule: 'your rule',
    adjusted: 'adjusted',
    adjustedTitle: (fields: string) => `Adjusted: ${fields}`,
    howToAvoid: (tip: string) => `How to avoid: ${tip}`,
    stacks: (n: number) => `${n} stacks`,
    firstTime: (t: string) => `first at ${t}`,
    dispels: 'Dispels: ',
    noDispel: 'no dispel',
    interrupted: 'Interrupted: ',
    dispelled: 'Dispelled: ',
    helped: 'Helped: ',
    positionsAt: 'Positions at the failure:',
    culpritRing: 'Orange ring: whoever carried what exploded.',
    whereAtFailure: 'Where everyone was at the moment of the failure.',
    watchVideo: 'watch in the video',
    mapHint: "Rings every 10 yards from the boss. The orientation may not match the game's; the distances do.",
    timeline: (show: boolean, n: number) => `${show ? 'Hide' : 'Show'} timeline (${n})`,
  },
);
