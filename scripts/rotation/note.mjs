// Condição do SimC (`if=`) em uma nota curta, em português e inglês ({ pt, en }), só para os
// padrões comuns. O que não dá para traduzir (variáveis, contas, eventos de raid) fica de fora.

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
    if (t && !parts.some((p) => p.pt === t.pt)) parts.push(t);
  }
  return parts.length ? { pt: parts.map((p) => p.pt).join(', '), en: parts.map((p) => p.en).join(', ') } : null;
}

const both = (pt, en) => ({ pt, en });

function translate(c, nameOf) {
  let m;
  const cmp = (op, n) => ({
    pt: { '>=': `${n}+`, '>': `${+n + 1}+`, '=': `${n}`, '<': `menos de ${n}`, '<=': `até ${n}` }[op],
    en: { '>=': `${n}+`, '>': `${+n + 1}+`, '=': `${n}`, '<': `fewer than ${n}`, '<=': `up to ${n}` }[op],
  });
  if ((m = c.match(/^!?buff\.(\w+)\.(up|react|down)$/))) {
    const neg = c.startsWith('!') !== (m[2] === 'down');
    return both(`${neg ? 'sem' : 'com'} ${nameOf(m[1])}`, `${neg ? 'without' : 'with'} ${nameOf(m[1])}`);
  }
  if ((m = c.match(/^buff\.(\w+)\.(?:stack|react)(>=|>|=)(\d+)$/))) {
    const n = cmp(m[2], m[3]);
    return both(`com ${n.pt} ${nameOf(m[1])}`, `with ${n.en} ${nameOf(m[1])}`);
  }
  if ((m = c.match(/^!?debuff\.(\w+)\.(up|down)$/))) {
    const neg = c.startsWith('!') !== (m[2] === 'down');
    return both(`${neg ? 'sem' : 'com'} ${nameOf(m[1])} no alvo`, `${neg ? 'without' : 'with'} ${nameOf(m[1])} on the target`);
  }
  if ((m = c.match(/^(?:dot\.(\w+)\.)?refreshable$/))) {
    const d = m[1] && nameOf(m[1].replace(/_dot$/, ''));
    return d ? both(`renovar ${d}`, `refresh ${d}`) : both('renovar no pandemic', 'refresh in pandemic');
  }
  if ((m = c.match(/^!dot\.(\w+)\.ticking$/))) {
    const d = nameOf(m[1].replace(/_dot$/, ''));
    return both(`se ${d} não estiver no alvo`, `if ${d} isn't on the target`);
  }
  if ((m = c.match(/^cooldown\.(\w+)\.(ready|up)$/))) return both(`${nameOf(m[1])} pronto`, `${nameOf(m[1])} ready`);
  if ((m = c.match(/^cooldown\.(\w+)\.remains(<|<=)([\d.]+)$/))) return both(`${nameOf(m[1])} volta em ${m[3]}s`, `${nameOf(m[1])} back in ${m[3]}s`);
  if ((m = c.match(/^cooldown\.(\w+)\.remains(>|>=)([\d.]+)$/))) return both(`${nameOf(m[1])} a mais de ${m[3]}s`, `${nameOf(m[1])} more than ${m[3]}s away`);
  if ((m = c.match(/^(?:active_enemies|spell_targets(?:\.\w+)?)(>=|>)(\d+)$/))) {
    const n = cmp(m[1], m[2]);
    return both(`${n.pt} alvos`, `${n.en} targets`);
  }
  if ((m = c.match(/^(?:active_enemies|spell_targets(?:\.\w+)?)=1$/))) return both('alvo único', 'single target');
  if ((m = c.match(/^target\.health\.pct(<|<=)(\d+)$/))) return both(`alvo abaixo de ${m[2]}%`, `target below ${m[2]}%`);
  if ((m = c.match(/^(\w+?)\.deficit(<|<=)(\d+)$/)) && RESOURCES[m[1]]) return both(`perto do máximo de ${RESOURCES[m[1]]}`, `near max ${RESOURCES[m[1]]}`);
  if ((m = c.match(/^(\w+?)(>=|>|=|<|<=)(\d+)$/)) && RESOURCES[m[1]]) {
    const n = cmp(m[2], m[3]);
    return both(`com ${n.pt} ${RESOURCES[m[1]]}`, `with ${n.en} ${RESOURCES[m[1]]}`);
  }
  if (/charges=max_charges|charges>=2|charges_fractional>=1\.[5-9]|full_recharge_time</.test(c)) return both('perto de encher as cargas', 'close to capping charges');
  if ((m = c.match(/^pet\.(\w+)\.active$/))) return both(`com ${nameOf(m[1])} ativo`, `with ${nameOf(m[1])} active`);
  if ((m = c.match(/^prev_gcd\.1\.(\w+)$/))) return both(`logo depois de ${nameOf(m[1])}`, `right after ${nameOf(m[1])}`);
  return null;
}
