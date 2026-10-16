// Tipos de regra em que o player listado é quem errou (e não só quem foi atingido).

/**
 * Regras em que o player listado é o culpado. Nas coletivas (soak, tank_soak, interrupt,
 * enrage) os listados são quem foi atingido pela falha, não quem errou; em failure_event
 * só aparece quem carregava o que explodiu.
 */
export const PERSONAL_BLAME = new Set(['avoidable_damage', 'tank_range', 'positioning', 'stack_limit', 'failure_event', 'exclusive_auras']);

/**
 * Tank toma dano evitável de propósito com frequência (segurar o boss parado, posicionar) e
 * tem vida e defensivos para isso: o erro pesa metade na nota e no placar.
 */
export const TANK_AVOIDABLE_FACTOR = 0.5;

/** Multiplicador do peso de um erro pela regra e pela role de quem errou (a regra pode pedir peso inteiro). */
export const blameFactor = (m: { kind: string; tankFull?: boolean }, role: string | null | undefined) =>
  m.kind === 'avoidable_damage' && role === 'tank' && !m.tankFull ? TANK_AVOIDABLE_FACTOR : 1;

/**
 * Erros do player numa mecânica: as ocorrências (dano evitável: ticks seguidos, como ficar 3s no
 * machado, são um erro só). Relatório antigo, sem ocorrências: os acertos.
 */
export const mistakes = (mp: { count: number; incidents?: number }) => mp.incidents ?? mp.count;

/** Erros da mecânica no pull: as ocorrências somadas (dano evitável) ou as falhas. */
export const mechanicMistakes = (m: { failures: number; incidents?: number }) => m.incidents ?? m.failures;
