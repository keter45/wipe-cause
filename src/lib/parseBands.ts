// Faixas de parse do Warcraft Logs (sem dependências: score.ts e wclParses.ts usam).

/**
 * As faixas do Warcraft Logs, a mesma escala para a nota do app e para o parse: cinza < 25,
 * verde < 50, azul < 75, roxo < 95, laranja 95–98, rosa 99, dourado 100. As cores também estão em
 * `.score-pill.q-*` (styles.css), conferidas por teste.
 */
export const PARSE_BANDS = [
  { min: 100, tier: 'gold', color: '#e5cc80' },
  { min: 99, tier: 'pink', color: '#e268a8' },
  { min: 95, tier: 'orange', color: '#ff8000' },
  { min: 75, tier: 'purple', color: '#a335ee' },
  { min: 50, tier: 'blue', color: '#0070ff' },
  { min: 25, tier: 'green', color: '#1eff00' },
  { min: -Infinity, tier: 'gray', color: '#9d9d9d' },
] as const;

/** A faixa de uma nota ou parse, pelo número mostrado (já arredondado). */
export const parseBand = (s: number) => PARSE_BANDS.find((b) => Math.round(s) >= b.min)!;
