// Condição do SimC (`if=`) em uma nota curta em português, só para os padrões comuns. O que não
// dá para traduzir (variáveis, contas, eventos de raid) fica de fora.

const RESOURCES = {
  soul_shard: 'Soul Shards',
  holy_power: 'Holy Power',
  runic_power: 'Runic Power',
  combo_points: 'combo points',
  insanity: 'Insanity',
  maelstrom: 'Maelstrom',
  astral_power: 'Astral Power',
  fury: 'Fury',
  focus: 'Focus',
  energy: 'Energy',
  rage: 'Rage',
  chi: 'Chi',
  essence: 'Essence',
  arcane_charges: 'Arcane Charges',
  rune: 'Runes',
};

/** `nameOf(token)` devolve o nome bonito de uma spell/buff ("sudden_doom" -> "Sudden Doom"). */
export function conditionNote(cond, nameOf) {
  if (!cond) return null;
  // com "ou" no nível de cima não dá para resumir sem perder o sentido
  let depth = 0;
  for (const ch of cond) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) return null;
  }
  const parts = [];
  for (let c of cond.split('&')) {
    c = c.trim().replace(/^\((.*)\)$/, '$1');
    const t = translate(c, nameOf);
    if (t) parts.push(t);
  }
  return parts.length ? [...new Set(parts)].join(', ') : null;
}

function translate(c, nameOf) {
  let m;
  const cmp = (op, n) => ({ '>=': `${n}+`, '>': `${+n + 1}+`, '=': `${n}`, '<': `menos de ${n}`, '<=': `até ${n}` })[op];
  if ((m = c.match(/^!?buff\.(\w+)\.(up|react|down)$/))) {
    const neg = c.startsWith('!') !== (m[2] === 'down');
    return `${neg ? 'sem' : 'com'} ${nameOf(m[1])}`;
  }
  if ((m = c.match(/^buff\.(\w+)\.(?:stack|react)(>=|>|=)(\d+)$/))) return `com ${cmp(m[2], m[3])} ${nameOf(m[1])}`;
  if ((m = c.match(/^!?debuff\.(\w+)\.(up|down)$/))) return `${c.startsWith('!') !== (m[2] === 'down') ? 'sem' : 'com'} ${nameOf(m[1])} no alvo`;
  if ((m = c.match(/^(?:dot\.(\w+)\.)?refreshable$/))) return m[1] ? `renovar ${nameOf(m[1].replace(/_dot$/, ''))}` : 'renovar no pandemic';
  if ((m = c.match(/^!dot\.(\w+)\.ticking$/))) return `se ${nameOf(m[1].replace(/_dot$/, ''))} não estiver no alvo`;
  if ((m = c.match(/^cooldown\.(\w+)\.(ready|up)$/))) return `${nameOf(m[1])} pronto`;
  if ((m = c.match(/^cooldown\.(\w+)\.remains(<|<=)([\d.]+)$/))) return `${nameOf(m[1])} volta em ${m[3]}s`;
  if ((m = c.match(/^cooldown\.(\w+)\.remains(>|>=)([\d.]+)$/))) return `${nameOf(m[1])} a mais de ${m[3]}s`;
  if ((m = c.match(/^(?:active_enemies|spell_targets(?:\.\w+)?)(>=|>)(\d+)$/))) return `${cmp(m[1], m[2])} alvos`;
  if ((m = c.match(/^(?:active_enemies|spell_targets(?:\.\w+)?)=1$/))) return 'alvo único';
  if ((m = c.match(/^target\.health\.pct(<|<=)(\d+)$/))) return `alvo abaixo de ${m[2]}%`;
  if ((m = c.match(/^(\w+?)\.deficit(<|<=)(\d+)$/)) && RESOURCES[m[1]]) return `perto do máximo de ${RESOURCES[m[1]]}`;
  if ((m = c.match(/^(\w+?)(>=|>|=|<|<=)(\d+)$/)) && RESOURCES[m[1]]) return `com ${cmp(m[2], m[3])} ${RESOURCES[m[1]]}`;
  if (/charges=max_charges|charges>=2|charges_fractional>=1\.[5-9]|full_recharge_time</.test(c)) return 'perto de encher as cargas';
  if ((m = c.match(/^pet\.(\w+)\.active$/))) return `com ${nameOf(m[1])} ativo`;
  if ((m = c.match(/^prev_gcd\.1\.(\w+)$/))) return `logo depois de ${nameOf(m[1])}`;
  return null;
}
