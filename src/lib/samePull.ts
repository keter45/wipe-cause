// "Mesmo pull" e "mesma noite", num lugar só: juntar log do PC e Warcraft Logs, não contar a
// mesma raide duas vezes na Evolução, achar o pull de uma simulação e a noite de uma nota.

/** Wipes mais curtos que isso a análise descarta (pull falso / reset). O mesmo `MIN_PULL_MS` do núcleo (analysis.rs). */
export const MIN_PULL_MS = 30_000;

/**
 * Pulls do mesmo boss que começam com menos disso de diferença são o mesmo pull (log e WCL
 * arredondam diferente). Menor que MIN_PULL_MS: dois pulls de verdade nunca ficam tão perto.
 */
export const SAME_PULL_MS = 20_000;

export const samePullStart = (a: number, b: number) => Math.abs(a - b) < SAME_PULL_MS;

/** A madrugada conta para a noite anterior: até essa hora local, ainda é a raide de ontem. */
const NIGHT_ROLLOVER_H = 6;

/** A noite de um pull (YYYY-MM-DD): a data local, com a madrugada contando para o dia anterior. */
export const nightDate = (startMs: number, tzOffsetHours: number | null | undefined) =>
  new Date(startMs + ((tzOffsetHours ?? 0) - NIGHT_ROLLOVER_H) * 3_600_000).toISOString().slice(0, 10);
