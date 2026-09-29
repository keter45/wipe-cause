// Tipos de regra em que o player listado é quem errou (e não só quem foi atingido).

/**
 * Regras em que o player listado é o culpado. Nas coletivas (soak, tank_soak, interrupt,
 * enrage) os listados são quem foi atingido pela falha, não quem errou; em failure_event
 * só aparece quem carregava o que explodiu.
 */
export const PERSONAL_BLAME = new Set(['avoidable_damage', 'tank_range', 'positioning', 'stack_limit', 'failure_event']);
