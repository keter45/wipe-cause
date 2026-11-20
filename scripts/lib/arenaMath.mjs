// Contas do scripts/arena-fit.mjs que não dependem de imagem: semelhança entre lugares do log e da imagem
// (Procrustes/Umeyama 2D) e a escrita em data/arenas.json que só mexe no que mudou (o diff fica pequeno).

/**
 * Semelhança 2D por mínimos quadrados: dst ≈ s·R(θ)·src + t, com R giro (sem espelho).
 * Forma fechada com números complexos (Umeyama em 2D): z = Σ conj(a)·b / Σ|a|², s = |z|, θ = arg z.
 * Precisa de pelo menos 2 pontos distintos.
 * @param {[number, number][]} src
 * @param {[number, number][]} dst
 * @returns {{ s: number, theta: number, t: [number, number], residuals: number[] }}
 */
export function similarity(src, dst) {
  const n = src.length;
  if (n < 2 || dst.length !== n) throw new Error('semelhança: precisa de 2 ou mais pares');
  const mean = (pts, i) => pts.reduce((sum, p) => sum + p[i], 0) / n;
  const [sx, sy, dx, dy] = [mean(src, 0), mean(src, 1), mean(dst, 0), mean(dst, 1)];
  let re = 0;
  let im = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = [src[i][0] - sx, src[i][1] - sy];
    const [bx, by] = [dst[i][0] - dx, dst[i][1] - dy];
    re += ax * bx + ay * by; // conj(a)·b = (ax - i·ay)(bx + i·by)
    im += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (norm === 0) throw new Error('semelhança: pontos iguais');
  const [zr, zi] = [re / norm, im / norm];
  const s = Math.hypot(zr, zi);
  const theta = Math.atan2(zi, zr);
  const [c, sn] = [Math.cos(theta), Math.sin(theta)];
  const t = [dx - s * (c * sx - sn * sy), dy - s * (sn * sx + c * sy)];
  const residuals = src.map((p, i) => Math.hypot(s * (c * p[0] - sn * p[1]) + t[0] - dst[i][0], s * (sn * p[0] + c * p[1]) + t[1] - dst[i][1]));
  return { s, theta, t, residuals };
}

/** Diferença (graus, 0..45) entre um giro e o múltiplo de 90° mais perto, e esse múltiplo. */
export function nearestQuarter(deg) {
  const q = Math.round(deg / 90) * 90;
  return { quarter: q === 0 ? 0 : q, diff: Math.abs(deg - q) };
}

// ---- escrita em data/arenas.json ----------------------------------------------------------------------

/** Ordem dos campos de uma arena; um campo novo entra depois do anterior que já existe. */
export const FIELD_ORDER = ['name', 'image', 'size', 'rotation', 'anchored', 'marks', 'pxPerYd', 'anchorPx', 'anchorAt', 'fit', 'floor', 'holes'];

const inline = (v) => {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`;
  return JSON.stringify(v);
};

/** Texto de um campo (sem a vírgula do fim), no estilo do arquivo; `orig` (texto antigo do campo) dá o estilo. */
function fieldText(key, value, orig) {
  const head = `   ${JSON.stringify(key)}: `;
  const empty = Array.isArray(value) && value.length === 0;
  if (empty || !['marks', 'floor', 'holes'].includes(key)) return head + inline(value);
  const wasInline = orig !== undefined && !orig.includes('\n');
  if (key === 'floor' && wasInline) return head + inline(value);
  if (key === 'marks') return `${head}[\n${value.map((m) => `    ${inline(m)}`).join(',\n')}\n   ]`;
  if (key === 'floor') return `${head}[\n${value.map((p) => `    ${inline(p)}`).join(',\n')}\n   ]`;
  // holes: cada buraco numa linha (como o do Ula'tek) ou cada ponto numa linha (como os outros)
  const rows = orig !== undefined && /^\s+\[\[/m.test(orig);
  if (rows) return `${head}[\n${value.map((h) => `    ${inline(h)}`).join(',\n')}\n   ]`;
  return `${head}[\n${value.map((h) => `    [\n${h.map((p) => `     ${inline(p)}`).join(',\n')}\n    ]`).join(',\n')}\n   ]`;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Põe os campos de `fields` na arena `id` do texto de data/arenas.json, mexendo só no que mudou (o resto
 * fica byte a byte). Campo ausente em `fields` fica como está (marks, offFloor, spanYd... à mão).
 * Devolve { text, changes: [{ key, before, after }] }; arena nova entra na ordem dos ids.
 */
export function patchArenaText(text, id, fields) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`  "${id}": {`));
  const changes = [];
  if (start < 0) {
    // arena nova: antes da primeira de id maior, ou no fim
    const entries = lines.map((l, i) => [/^ {2}"(\d+)": \{/.exec(l), i]).filter(([m]) => m);
    const next = entries.find(([m]) => Number(m[1]) > Number(id));
    const body = FIELD_ORDER.filter((k) => fields[k] !== undefined).map((k) => fieldText(k, fields[k]));
    const block = [`  "${id}": {`, ...body.join(',\n').split('\n'), '  }'];
    if (next) {
      block[block.length - 1] += ',';
      lines.splice(next[1], 0, ...block);
    } else {
      // fim: depois da última arena (a linha `  }` antes do `  }` / ` }` de fora)
      const close = lines.findLastIndex((l) => l === ' }');
      lines[close - 1] += ',';
      lines.splice(close, 0, ...block);
    }
    for (const [k, v] of Object.entries(fields)) changes.push({ key: k, before: undefined, after: v });
    return { text: lines.join(eol), changes };
  }
  let end = start + 1;
  while (!/^ {2}\},?$/.test(lines[end])) end++;
  // campos: blocos que começam em `   "chave":`
  const blocks = [];
  for (let i = start + 1; i < end; i++) {
    const m = /^ {3}"([^"]+)":/.exec(lines[i]);
    if (m) blocks.push({ key: m[1], lines: [lines[i]] });
    else blocks[blocks.length - 1].lines.push(lines[i]);
  }
  for (const b of blocks) b.raw = b.lines.join('\n').replace(/,$/, '');
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const old = blocks.find((b) => b.key === key);
    const before = old ? JSON.parse(`{${old.raw}}`)[key] : undefined;
    if (old && sameValue(before, value)) continue;
    const raw = fieldText(key, value, old?.raw);
    changes.push({ key, before, after: value });
    if (old) { old.raw = raw; continue; }
    // campo novo: depois do campo anterior da ordem que existe
    const rank = FIELD_ORDER.indexOf(key);
    let at = -1;
    blocks.forEach((b, i) => { const r = FIELD_ORDER.indexOf(b.key); if (r >= 0 && r < rank) at = i; });
    blocks.splice(at + 1, 0, { key, raw });
  }
  const out = blocks.map((b) => b.raw).join(',\n').split('\n');
  lines.splice(start + 1, end - start - 1, ...out);
  return { text: lines.join(eol), changes };
}
