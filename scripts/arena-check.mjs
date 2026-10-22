// Confere o chão da arena de um boss (data/arenas.json) com o que o log mostra: toda unidade que não
// é player (boss, adds, orbs, fantasmas...) tem que ficar dentro do chão; só player aparece fora, e aí
// está caindo. A exceção são as unidades que vivem fora do chão de verdade (boss que nada no ácido em volta
// da plataforma, add que sai do poço do meio): `offFloor` (ids de npc) na arena, e elas saem como FORA OK.
// Uma arena pequena demais (o encaixe pelos pisões encolhe quando a raide evita a borda)
// aparece aqui como unidades fora. Ferramenta de conferência (não roda no app):
//
//   node scripts/arena-check.mjs <WoWCombatLog.txt> <encounter id> [--difficulty 16] [--draw saida.svg]
//
// Com --draw, grava um SVG com a imagem da arena, o chão e uma amostra das posições de cada unidade
// (abra no navegador): mostra de cara se a unidade anda fora do chão de verdade (boss que nada em volta
// da plataforma) ou se o chão está errado.
// Imprime, por tipo de unidade (npc), quantas posições caíram fora do chão e até onde as unidades foram
// (a caixa delas, nas coordenadas do log), e a mesma conta para os players vivos.

import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const [file, encounterArg, ...rest] = process.argv.slice(2);
if (!file || !encounterArg) {
  console.error('uso: node scripts/arena-check.mjs <WoWCombatLog.txt> <encounter id> [--difficulty 16]');
  process.exit(2);
}
const encounter = Number(encounterArg);
const di = rest.indexOf('--difficulty');
const difficulty = di >= 0 ? rest[di + 1] : '16';
const dw = rest.indexOf('--draw');
const drawTo = dw >= 0 ? rest[dw + 1] : null;
const SAMPLE = 1500;
const root = path.resolve(import.meta.dirname, '..');
const arena = JSON.parse(fs.readFileSync(path.join(root, 'data', 'arenas.json'), 'utf8')).arenas?.[encounter];
if (!arena) {
  console.error(`sem arena para ${encounter} em data/arenas.json`);
  process.exit(1);
}

/** Dentro do chão: dentro do contorno e fora dos buracos (coordenadas do log). */
const inPoly = (x, y, poly) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};
const onFloor = (x, y) => inPoly(x, y, arena.floor) && !(arena.holes ?? []).some((h) => inPoly(x, y, h));
/** Distância (jd) de um ponto até o contorno de um polígono. */
const toEdge = (x, y, poly) => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + dx * k - x, ay + dy * k - y));
  }
  return best;
};
/** Distância (jd) até o chão: 0 dentro; fora do contorno, até ele; dentro de um buraco, até a borda do buraco. */
const outBy = (x, y) => {
  if (onFloor(x, y)) return 0;
  const hole = (arena.holes ?? []).find((h) => inPoly(x, y, h));
  return toEdge(x, y, hole ?? arena.floor);
};

// por tipo: [nome, posições, fora, maior distância fora, caixa x0 x1 y0 y1]
const kinds = new Map();
const add = (key, name, x, y) => {
  let k = kinds.get(key);
  if (!k) kinds.set(key, (k = { name, n: 0, out: 0, hole: 0, far: 0, box: [Infinity, -Infinity, Infinity, -Infinity], pts: [] }));
  k.n++;
  // amostra uniforme (reservoir) para o desenho
  if (k.pts.length < SAMPLE) k.pts.push([x, y]);
  else if (Math.random() < SAMPLE / k.n) k.pts[Math.floor(Math.random() * SAMPLE)] = [x, y];
  const d = outBy(x, y);
  if (d > 0) {
    k.out++;
    if ((arena.holes ?? []).some((h) => inPoly(x, y, h))) k.hole++;
    k.far = Math.max(k.far, d);
  }
  k.box = [Math.min(k.box[0], x), Math.max(k.box[1], x), Math.min(k.box[2], y), Math.max(k.box[3], y)];
};

let inFight = false;
const gone = new Set();
const rl = createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
for await (const line of rl) {
  const sp = line.indexOf('  ');
  if (sp < 0) continue;
  const body = line.slice(sp + 2);
  if (body.startsWith('ENCOUNTER_START,')) {
    const f = body.split(',');
    inFight = Number(f[1]) === encounter && f[3] === difficulty;
    gone.clear();
    continue;
  }
  if (body.startsWith('ENCOUNTER_END')) inFight = false;
  if (!inFight) continue;
  const f = body.split(',');
  // quem morreu ou está caindo não conta mais
  if (f[0] === 'UNIT_DIED' || f[0] === 'ENVIRONMENTAL_DAMAGE') gone.add(f[5]);
  if (f[0] === 'SPELL_RESURRECT') gone.delete(f[5]);
  // posição: os dois decimais seguidos do uiMapID (inteiro) e da direção (decimal), no bloco advanced
  const j = f.findIndex((v, k) => k > 9 && v.includes('.') && f[k + 1]?.includes('.') && /^\d+$/.test(f[k + 2] ?? '') && f[k + 3]?.includes('.'));
  if (j < 0) continue;
  const gi = f.findIndex((v, k) => k >= 9 && k < j && /^(Player|Creature|Vehicle)-/.test(v));
  const g = gi >= 0 ? f[gi] : null;
  if (!g || gone.has(g)) continue;
  // pets e guardiões (o dono, no campo seguinte, é um player) não são da luta
  if (!g.startsWith('Player-') && f[gi + 1]?.startsWith('Player-')) continue;
  const x = +f[j];
  const y = +f[j + 1];
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) continue;
  if (g.startsWith('Player-')) add('player', 'players vivos', x, y);
  else {
    const npc = g.split('-')[5];
    // o nome vem do campo da unidade (fonte ou alvo) que tem esse guid
    const name = f[1] === g ? f[2] : f[5] === g ? f[6] : `npc ${npc}`;
    add(npc, name.replace(/"/g, ''), x, y);
  }
}

console.log(`${arena.name} · chão x ${Math.min(...arena.floor.map((p) => p[0]))}..${Math.max(...arena.floor.map((p) => p[0]))}, y ${Math.min(...arena.floor.map((p) => p[1]))}..${Math.max(...arena.floor.map((p) => p[1]))}`);
const rows = [...kinds.entries()].sort((a, b) => b[1].out / b[1].n - a[1].out / a[1].n);
for (const [key, k] of rows) {
  const pct = ((k.out / k.n) * 100).toFixed(2);
  const flag =
    key === 'player' ? (k.out / k.n > 0.01 ? 'ATENÇÃO' : 'OK') : (arena.offFloor ?? []).includes(Number(key)) ? 'FORA OK' : k.out > 0 && k.far > 2 ? 'REVISAR' : 'OK';
  console.log(`${flag.padEnd(8)} ${k.name.padEnd(28)} ${String(k.n).padStart(8)} posições · fora ${pct}%${k.hole ? ` (${((k.hole / k.n) * 100).toFixed(2)}% no buraco)` : ''} (até ${k.far.toFixed(1)} jd) · x ${k.box[0].toFixed(1)}..${k.box[1].toFixed(1)} y ${k.box[2].toFixed(1)}..${k.box[3].toFixed(1)}`);
}

if (drawTo) {
  // log -> pixel da imagem, como src/lib/arenas.ts: no mapa (x = -Y, y = X), girado por `rotation`
  const s = arena.pxPerYd;
  const r = ((arena.rotation ?? 0) * Math.PI) / 180;
  const px = ([x, y]) => {
    const [mx, my] = [-(y - arena.anchorAt[1]), x - arena.anchorAt[0]];
    return [arena.anchorPx[0] + s * (Math.cos(r) * mx - Math.sin(r) * my), arena.anchorPx[1] + s * (-Math.sin(r) * mx - Math.cos(r) * my)];
  };
  const poly = (p, cls) => `<polygon points="${p.map((q) => px(q).map((v) => v.toFixed(1)).join(',')).join(' ')}" class="${cls}"/>`;
  const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff2d55', '#ffffff'];
  // players por baixo, depois as unidades com mais posições
  const drawn = [...kinds.entries()].sort((a, b) => (a[0] === 'player' ? -1 : b[0] === 'player' ? 1 : b[1].n - a[1].n)).slice(0, colors.length);
  const dots = drawn
    .map(([key, k], i) => {
      const c = key === 'player' ? '#9aa0a6' : colors[(i - 1 + colors.length) % colors.length];
      return `<g fill="${c}" opacity="${key === 'player' ? 0.35 : 0.8}">${k.pts.map((q) => { const [a, b] = px(q); return `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="${key === 'player' ? 3 : 5}"/>`; }).join('')}</g>`;
    })
    .join('');
  const legend = drawn
    .map(([key, k], i) => `<text x="20" y="${40 + i * 34}" fill="${key === 'player' ? '#9aa0a6' : colors[(i - 1 + colors.length) % colors.length]}">${k.name}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${arena.size[0]} ${arena.size[1]}">
<style>.floor{fill:none;stroke:#fff;stroke-width:4;stroke-dasharray:16 10}.hole{fill:none;stroke:#f0f;stroke-width:4;stroke-dasharray:16 10}text{font:bold 28px sans-serif;paint-order:stroke;stroke:#000;stroke-width:6}</style>
<image href="${arena.image}" width="${arena.size[0]}" height="${arena.size[1]}"/>
${poly(arena.floor, 'floor')}${(arena.holes ?? []).map((h) => poly(h, 'hole')).join('')}${dots}${legend}</svg>`;
  fs.writeFileSync(drawTo, svg);
  console.log(`desenho: ${drawTo}`);
}
