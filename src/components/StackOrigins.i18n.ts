import { defineMessages } from '../i18n';

export const stackOriginsMsg = defineMessages(
  {
    head: 'de onde vieram os stacks na noite',
    avoidable: 'Evitáveis',
    unavoidable: 'Inevitáveis',
    removed: 'Tirados',
    unknown: 'Sem origem',
    player: 'Player',
    maxStacks: 'Máx.',
    maxStacksTitle: 'Mais stacks que chegou a ter num pull',
    perPull: (n: string) => `${n} por pull`,
    pulls: 'Pulls',
    noAvoidable: 'Ninguém pegou stack evitável nesta noite.',
    legend: (name: string) =>
      `Evitável = stack de uma mecânica que dava para não tomar (cada um também conta como erro na regra dela). ${name} só culpa quem pegou pelo menos um evitável. Tirados = stacks removidos (ex.: soak que limpa).`,
  },
  {
    head: 'where the stacks came from tonight',
    avoidable: 'Avoidable',
    unavoidable: 'Unavoidable',
    removed: 'Removed',
    unknown: 'No source',
    player: 'Player',
    maxStacks: 'Max',
    maxStacksTitle: 'Most stacks reached in a pull',
    perPull: (n: string) => `${n} per pull`,
    pulls: 'Pulls',
    noAvoidable: 'Nobody took an avoidable stack tonight.',
    legend: (name: string) =>
      `Avoidable = a stack from a mechanic that could be dodged (each one also counts as a mistake in that mechanic's rule). ${name} only blames whoever took at least one avoidable stack. Removed = stacks taken away (e.g. a cleansing soak).`,
  },
);
