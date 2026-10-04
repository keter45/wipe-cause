import { defineMessages } from '../i18n';

/** Mensagens das consultas ao Warcraft Logs (parses, tops) e dos ajustes de regra importados. */
export const wclMsg = defineMessages(
  {
    noRankings: 'Sem rankings para esta dificuldade ou spec no Warcraft Logs.',
    topFightMissing: 'Fight do top não encontrado no Warcraft Logs (report privado ou apagado).',
    actorMissing: (name: string) => `${name} não aparece no report do Warcraft Logs.`,
    killMissing: 'Este kill não foi achado no report do Warcraft Logs.',
    parsesOnlyInApp: 'O parse do Warcraft Logs aparece no app instalado.',
    parsesConnect: 'Conecte o Warcraft Logs em Configurações para ver os parses.',
    parsesNeedLink: 'Cole o link do report da noite (Warcraft Logs, no topo) para ver os parses deste kill.',
    tuningNotJson: 'O arquivo não é um JSON válido.',
    tuningNotOurs: 'O arquivo não é de ajustes de regras do Wipe Cause.',
    tuningOtherBoss: (boss: string | null) => `Esses ajustes são de outro boss${boss ? ` (${boss})` : ''}.`,
  },
  {
    noRankings: 'No rankings for this difficulty or spec on Warcraft Logs.',
    topFightMissing: "The top player's fight wasn't found on Warcraft Logs (private or deleted report).",
    actorMissing: (name: string) => `${name} doesn't show up in the Warcraft Logs report.`,
    killMissing: "This kill wasn't found in the Warcraft Logs report.",
    parsesOnlyInApp: 'The Warcraft Logs parse shows up in the installed app.',
    parsesConnect: 'Connect Warcraft Logs in Settings to see the parses.',
    parsesNeedLink: "Paste the night's report link (Warcraft Logs, at the top) to see the parses for this kill.",
    tuningNotJson: "The file isn't valid JSON.",
    tuningNotOurs: "The file isn't a Wipe Cause rule adjustments file.",
    tuningOtherBoss: (boss: string | null) => `These adjustments are for another boss${boss ? ` (${boss})` : ''}.`,
  },
);
