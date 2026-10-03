// Escreve o modelo da rotação no mesmo formato dos YAMLs escritos à mão em rotations/.

const isToken = (s) => /^[a-z][a-z0-9_]*$/.test(s);
const scalar = (v) => (typeof v === 'string' ? (isToken(v) ? v : JSON.stringify(v)) : String(v));
const inlineValue = (v) => (Array.isArray(v) ? `[${v.map((x) => (typeof x === 'string' && isToken(x) ? x : scalar(x))).join(', ')}]` : scalar(v));
const inlineMap = (o) =>
  `{ ${Object.entries(o)
    .map(([k, v]) => `${k}: ${k === 'spell' || k === 'buff' ? v : inlineValue(v)}`)
    .join(', ')} }`;

export function toYaml(m, header = []) {
  const L = [...header.map((h) => (h ? `# ${h}` : '#'))];
  L.push(`spec: ${m.spec}`, `name: ${scalar(m.name)}`, `patch: ${scalar(m.patch)}`, 'sources:');
  for (const s of m.sources) L.push(`  - title: ${scalar(s.title)}`, `    url: ${s.url}`);
  if (m.ignore_casts?.length) L.push('', '# casts no log que não são o player apertando um botão', `ignore_casts: ${inlineValue(m.ignore_casts)}`);
  L.push('', 'key_points:', ...m.key_points.map((k) => `  - ${scalar(k)}`));
  L.push('', 'hero_trees:');
  for (const t of m.hero_trees) L.push(`  - key: ${t.key}`, `    name: ${scalar(t.name)}`, `    markers: ${inlineValue(t.markers)}`);
  L.push('', 'abilities:', ...Object.entries(m.abilities).map(([k, a]) => `  ${k}: ${inlineMap(a)}`));
  L.push('', Object.keys(m.buffs).length ? 'buffs:' : 'buffs: {}', ...Object.entries(m.buffs).map(([k, b]) => `  ${k}: ${inlineMap(b)}`));
  L.push('', 'priority:');
  for (const [tree, modes] of Object.entries(m.priority)) {
    if (!modes.st?.length && !modes.aoe?.length) {
      L.push(`  ${tree}: {}`);
      continue;
    }
    L.push(`  ${tree}:`);
    for (const mode of ['st', 'aoe']) {
      if (!modes[mode]?.length) continue;
      L.push(`    ${mode}:`, ...modes[mode].map((i) => `      - ${inlineMap(i.note ? { spell: i.spell, note: i.note } : { spell: i.spell })}`));
    }
  }
  L.push('', 'opener:');
  for (const [k, v] of Object.entries(m.opener)) L.push(`  ${k}: ${inlineValue(v)}`);
  L.push('', 'checks:');
  for (const c of m.checks) {
    const [first, ...rest] = Object.entries(c);
    L.push(`  - ${first[0]}: ${inlineValue(first[1])}`, ...rest.map(([k, v]) => `    ${k}: ${inlineValue(v)}`));
  }
  return L.join('\n') + '\n';
}
