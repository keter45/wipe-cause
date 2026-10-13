import { defineMessages } from '../i18n';

export const pairingMsg = defineMessages(
  {
    title: 'Encontros com soma errada',
    over: (target: number) => `passou de ${target}`,
    overAlready: 'rodada já sem solução',
    broke: 'deixou a rodada sem solução',
    harmless: 'sem prejuízo',
    unknownStacks: 'stacks desconhecidos',
    wentTo: 'foi até',
    approachPct: (pct: number) => `(${pct}% da aproximação)`,
    walkedTitle: 'Quem andou na direção do outro nos 5s antes do encontro',
    bothMoved: 'os dois andaram (ou já estavam juntos)',
    needed: (stacks: number) => `precisava de ${stacks}:`,
    nearest: (yd: string) => `a ${yd} jd`,
    replay: (open: boolean): string => (open ? 'Fechar replay' : 'Ver replay'),
  },
  {
    title: 'Touches with the wrong sum',
    over: (target: number) => `went over ${target}`,
    overAlready: 'round already unsolvable',
    broke: 'left the round with no solution',
    harmless: 'no harm',
    unknownStacks: 'unknown stacks',
    wentTo: 'walked into',
    approachPct: (pct: number) => `(${pct}% of the approach)`,
    walkedTitle: 'Who walked toward the other in the 5s before the touch',
    bothMoved: 'both moved (or were already together)',
    needed: (stacks: number) => `needed ${stacks}:`,
    nearest: (yd: string) => `${yd} yd away`,
    replay: (open: boolean) => (open ? 'Close replay' : 'Watch replay'),
  },
);
