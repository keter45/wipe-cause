// Alinha a imagem de fundo de cada arena (raidplan.io) com as coordenadas do combat log e acha o chão
// andável. Ferramenta de calibração (não roda no app):
//
//   node scripts/arena-fit.mjs <occupancy.json> <pasta das imagens> <pasta de saída> [--write] [--anchors <arquivo.json>]
//
//   --write    depois do encaixe, grava o boss em data/arenas.json com os nomes do app (url -> image, score -> fit,
//              sPx/u0/v0/cx/cy -> pxPerYd/anchorPx/anchorAt). Só mexe no que mudou: marks, offFloor, anchored,
//              rotation (quando não vem do encaixe), name e spanYd à mão ficam como estão. Mostra o diff (antes -> depois).
//   --anchors  (com ARENA=<id>) pares [{ "name": "fonte de fogo", "log": [x, y], "px": [u, v] }, ...]: lugar no log
//              x pixel na imagem de 1224 de largura. Semelhança com giro livre por mínimos quadrados, relatório do erro
//              de cada par em jardas e refino pelas paredes (pisões dentro do contorno), como um `fixed`. Giro que não é
//              múltiplo de 90 (mais de 2 graus) grava `rotation` e `anchored: true`; os nomes viram `marks`
//              (campos opcionais por par: `en`, `color`, `radius`).
//
// occupancy.json: onde os players pisaram em cada boss (`wipe-cli positions`, juntado por boss).
// Para cada arena: o chão (polígono marcado na imagem, ou tudo que não tem a cor do perigo) e a
// transformação mundo -> pixel (8 orientações, escala, posição) que põe mais pisões no chão.
// Grava <saída>/arenas.json e uma imagem de conferência por boss (<saída>/check-<boss>.png).
// Precisa do ffmpeg no PATH (decodifica a imagem).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { nearestQuarter, patchArenaText, similarity } from './lib/arenaMath.mjs';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const anchorsAt = argv.indexOf('--anchors');
const ANCHORS_FILE = anchorsAt >= 0 ? argv[anchorsAt + 1] : null;
if (anchorsAt >= 0 && (!ANCHORS_FILE || ANCHORS_FILE.startsWith('--'))) throw new Error('--anchors precisa de um arquivo');
const [occFile, imgDir, outDir] = argv.filter((x, i) => !x.startsWith('--') && i !== (anchorsAt >= 0 ? anchorsAt + 1 : -1));
if (!outDir) throw new Error('uso: node scripts/arena-fit.mjs <occupancy.json> <imagens> <saída> [--write] [--anchors <arquivo.json>]');
fs.mkdirSync(outDir, { recursive: true });
const occ = JSON.parse(fs.readFileSync(occFile, 'utf8'));

// Largura de trabalho (px). Coordenadas dos polígonos e amostras: na imagem com 1224 de largura.
const WORK = 612;
const MARK = 1224;

/** Arenas: imagem do raidplan, chão (polígono / buracos, ou cores de perigo). */
const ARENAS = [
  // spanYd: largura do chão (o polígono) em jardas, quando ela é conhecida. No Altar ninguém fica na borda
  // (as poças saem das laterais), e o encaixe pelos pisões encolhia a plataforma para 83 jd; orbs e
  // fantasmas (que nunca saem dela) vão até ±47 jd do meio: 100,8 jd (14 e 15/10)
  { id: 3429, img: '07.bargained-ort-v108', url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/07.bargained-ort-v108.jpg', poly: [[292, 18], [935, 18], [935, 665], [292, 665]], spanYd: 100.8 },
  { id: 3420, img: '05.sszorak-ort-v122', url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/05.sszorak-ort-v122.jpg', poly: [[475, 8], [750, 8], [945, 200], [945, 480], [750, 678], [475, 678], [278, 480], [278, 200]] },
  {
    id: 3421,
    img: '06.twinfangs-ort-v140',
    url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/06.twinfangs-ort-v140.jpg',
    poly: [[548, 35], [690, 35], [965, 560], [905, 658], [318, 658], [260, 555]],
    holes: [[[580, 262], [650, 262], [740, 440], [700, 515], [525, 515], [485, 440]]],
  },
  // Ula'tek: a sala inteira (Full Room), porque na P2 a raide se divide nas bordas dos lados (y ±110-127). A
  // transformação é a da plataforma do meio, que já encaixava a 0,984 com a imagem só dela: o octógono tem 78 jd
  // no log e 280 px aqui (09/11). O veneno em volta são dois buracos (em cima e embaixo), separados pelas pontes.
  {
    id: 3492,
    img: '08.ulatek-ort-full-v185',
    url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/08.ulatek-ort-full-v185.jpg',
    poly: [[100, 0], [1124, 0], [1124, 686], [100, 686]],
    holes: [
      [[472, 285], [472, 300], [330, 300], [330, 230], [468, 30], [756, 30], [894, 230], [894, 300], [752, 300], [752, 285], [670, 203], [555, 203]],
      [[472, 401], [472, 386], [330, 386], [330, 456], [468, 656], [756, 656], [894, 456], [894, 386], [752, 386], [752, 401], [670, 483], [555, 483]],
    ],
    fixed: { rotation: 0, s: 3.575, u: 612, v: 343, cx: 1553.55, cy: 0.25 },
  },
  { id: 3497, img: '04.lostexplorers-ort-v112', url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/04.lostexplorers-ort-v112.jpg', poly: [[380, 5], [845, 5], [950, 195], [950, 500], [845, 680], [380, 680], [270, 500], [270, 195]] },
  {
    id: 3445,
    img: '02.sentinels-ort-v108',
    url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/02.sentinels-ort-v108.jpg',
    poly: [[285, 0], [935, 0], [935, 230], [1020, 290], [1020, 400], [935, 465], [935, 685], [285, 685], [285, 465], [200, 400], [200, 290], [285, 230]],
  },
  // Vashnik: a sala é girada no mundo (-58,4°) e a luta fica toda na metade das fontes (laranja e roxa, embaixo).
  // O encaixe pelos pisões espalhava a raide pela sala inteira; aqui a transformação é fixa (`fixed`: giro, escala e
  // posição, em pixels da imagem com 1224 de largura, como os polígonos), pelas três fontes: os Shrouded Venom nascem
  // onde o boss fica, na de sombra; os Burning Venom vistos mais cedo saem da de fogo; o Clotting Venom, da de sangue.
  // Refinada para os pisões ficarem dentro da sala: 98,9% dentro, cada fonte a até 6 jd (21/10)
  { id: 3455, img: '03.vashnik-ort-enter-v180', url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/03.vashnik-ort-enter-v180.jpg', poly: [[450, 6], [774, 6], [845, 58], [955, 58], [994, 98], [994, 257], [955, 294], [900, 343], [900, 514], [918, 551], [875, 600], [796, 618], [771, 649], [771, 796], [453, 796], [453, 649], [428, 618], [349, 600], [306, 551], [324, 514], [324, 343], [269, 294], [230, 257], [230, 98], [269, 58], [379, 58]], fixed: { rotation: -58.37, s: 4.6921, u: 804.79, v: 547.47, cx: 466, cy: -329 } },
  { id: 3513, img: '01.kithix-ort-v176', url: 'https://cdn.raidplan.io/raid/wow.kithix/map/01.kithix-ort-v176.jpg', hazard: [[100, 400], [1100, 500], [150, 640], [1050, 250]] },
  { id: 3470, img: '01.nakzali-ort-v105', url: 'https://cdn.raidplan.io/raid/wow.venomabyss/map/01.nakzali-ort-v105.jpg', disk: [612, 342, 330], holeDisk: [612, 342, 48] },
];
const only = process.env.ARENA ? Number(process.env.ARENA) : null;

/** Imagem em RGB na largura de trabalho. */
function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const h = Math.round((probe[1] * WORK) / probe[0]);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${WORK}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  return { w: WORK, h, rgb: raw, origW: probe[0], origH: probe[1] };
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Chão: 1 = andável. Polígono (menos buracos), ou o que não tem a cor do perigo (o maior pedaço). */
function floorMask(a, im) {
  const k = WORK / MARK;
  const m = new Uint8Array(im.w * im.h);
  if (a.disk) {
    // sala redonda com um buraco no meio (o poço do Nek'zali): o buraco é a âncora
    const [cx, cy, R] = a.disk.map((v) => v * k);
    const [hx, hy, hr] = a.holeDisk.map((v) => v * k);
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) m[y * im.w + x] = Math.hypot(x - cx, y - cy) <= R && Math.hypot(x - hx, y - hy) > hr ? 1 : 0;
    return m;
  }
  if (a.poly) {
    const poly = a.poly.map(([x, y]) => [x * k, y * k]);
    const holes = (a.holes ?? []).map((h) => h.map(([x, y]) => [x * k, y * k]));
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) m[y * im.w + x] = inPoly(x + 0.5, y + 0.5, poly) && !holes.some((h) => inPoly(x + 0.5, y + 0.5, h)) ? 1 : 0;
    return m;
  }
  // cores do perigo: as dos quadrados em volta das amostras
  const ref = [];
  for (const [sx, sy] of a.hazard) {
    const cx = Math.round(sx * k);
    const cy = Math.round(sy * k);
    for (let y = cy - 10; y <= cy + 10; y += 2) for (let x = cx - 10; x <= cx + 10; x += 2) {
      if (x < 0 || y < 0 || x >= im.w || y >= im.h) continue;
      const i = (y * im.w + x) * 3;
      ref.push([im.rgb[i], im.rgb[i + 1], im.rgb[i + 2]]);
    }
  }
  for (let p = 0; p < im.w * im.h; p++) {
    const r = im.rgb[p * 3];
    const g = im.rgb[p * 3 + 1];
    const b = im.rgb[p * 3 + 2];
    let best = Infinity;
    for (const c of ref) best = Math.min(best, (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2);
    m[p] = ref.length === 0 || best > 30 ** 2 ? 1 : 0;
  }
  return largestComponent(open(m, im.w, im.h, 2), im.w, im.h);
}

/** Abertura (erosão + dilatação) para tirar pontinhos e pontes finas. */
function open(m, w, h, r) {
  const er = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) { ok = 0; break; }
    }
    er[y * w + x] = ok;
  }
  const di = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!er[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) di[yy * w + xx] = 1;
    }
  }
  return di;
}

function largestComponent(m, w, h) {
  const lab = new Int32Array(m.length);
  let best = 0;
  let bestN = 0;
  let next = 1;
  const stack = [];
  for (let p = 0; p < m.length; p++) {
    if (!m[p] || lab[p]) continue;
    let n = 0;
    lab[p] = next;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop();
      n++;
      const x = q % w;
      const y = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (m[r] && !lab[r]) { lab[r] = next; stack.push(r); }
      }
    }
    if (n > bestN) { bestN = n; best = next; }
    next++;
  }
  return Uint8Array.from(lab, (l) => (l === best ? 1 : 0));
}

/** Orientações: (X, Y) do log -> (direita, baixo) da imagem. */
const ORIENT = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1],
  [0, 1, 1, 0], [0, -1, 1, 0], [0, 1, -1, 0], [0, -1, -1, 0],
];

/** Direita = leste (-Y), baixo = sul (-X). */
const NORTH_UP = 7;
/** Giro da imagem (graus) de cada orientação sem espelho (as outras não existem no app). */
const ROTATION = { 7: 0, 2: -90, 4: 180, 1: 90 };

/** Matriz (X, Y) do log -> (direita, baixo) da imagem: a da orientação, ou a de um giro qualquer (`t.rot`). */
function mat(t) {
  if (t.rot == null) return ORIENT[t.o];
  const r = (t.rot * Math.PI) / 180;
  return [-Math.sin(r), -Math.cos(r), -Math.cos(r), Math.sin(r)];
}

/** Pisões com bastante gente (tira quem caiu, voou ou passou correndo). */
function densePoints(o, core) {
  const tot = o.cells.reduce((s, c) => s + c[2], 0);
  const thr = Math.max(3, (tot / o.cells.length) * 0.05);
  let pts = o.cells.filter((c) => c[2] >= thr).map((c) => [c[0] + 0.5, c[1] + 0.5]);
  if (core) {
    // só a sala principal (o Ula'tek tem pontes e caminhos para os lados, fora da imagem): em volta da mediana
    const med = (i) => [...pts.map((p) => p[i])].sort((a, b) => a - b)[pts.length >> 1];
    const [mx, my] = [med(0), med(1)];
    pts = pts.filter((p) => Math.hypot(p[0] - mx, p[1] - my) <= core);
  }
  return pts;
}

/**
 * Nota da transformação: pisões no chão (quanto mais, melhor) e chão coberto (o chão da imagem
 * tem que ser onde os players andam, senão a escala cresce até caber tudo). F1 dos dois.
 */
function score(pts, mask, im, t) {
  const [a, b, c, d] = mat(t);
  const cover = new Uint8Array(im.w * im.h);
  let inside = 0;
  const r = Math.max(1, Math.round(t.s * 1.5));
  for (const [X, Y] of pts) {
    const dx = X - t.cx;
    const dy = Y - t.cy;
    const u = Math.round(t.u + t.s * (a * dx + b * dy));
    const v = Math.round(t.v + t.s * (c * dx + d * dy));
    if (u < 0 || v < 0 || u >= im.w || v >= im.h) continue;
    if (mask[v * im.w + u]) inside++;
    for (let yy = v - r; yy <= v + r; yy++) for (let xx = u - r; xx <= u + r; xx++) if (xx >= 0 && yy >= 0 && xx < im.w && yy < im.h) cover[yy * im.w + xx] = 1;
  }
  let floor = 0;
  let covered = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { floor++; if (cover[p]) covered++; }
  const prec = inside / pts.length;
  const rec = floor ? covered / floor : 0;
  return prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
}

function fit(pts, mask, im, a) {
  // transformação conhecida (medida fora daqui): só passa para a escala de trabalho e dá a nota
  if (a.fixed) {
    const k = WORK / MARK;
    const t = { o: -1, rot: a.fixed.rotation, s: a.fixed.s * k, u: a.fixed.u * k, v: a.fixed.v * k, cx: a.fixed.cx, cy: a.fixed.cy };
    return { ...t, score: score(pts, mask, im, t) };
  }
  let floor = 0;
  let fu = 0;
  let fv = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { floor++; fu += p % im.w; fv += (p / im.w) | 0; }
  fu /= floor;
  fv /= floor;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  // largura do chão conhecida (spanYd): a escala fica travada e só a posição é procurada
  const fixed = a.spanYd && a.poly ? (Math.max(...a.poly.map((q) => q[0])) - Math.min(...a.poly.map((q) => q[0]))) * (WORK / MARK) / a.spanYd : null;
  const s0 = fixed ?? Math.sqrt(floor / pts.length);
  let best = null;
  // mapa do raidplan com o norte para cima e o X do log para o norte, Y para o oeste: a mesma
  // orientação em todo boss (o Twin Fangs, sem simetria, confirma; ORIENT_ALL=1 testa as 8)
  // `orient` na arena: a imagem vem em outra orientação (confira com o que tem lugar certo: fontes, portas)
  for (const o of process.env.ORIENT_ALL ? ORIENT.map((_, i) => i) : [a.orient ?? NORTH_UP]) {
    let t = { o, s: s0, u: fu, v: fv, cx, cy };
    let sc = score(pts, mask, im, t);
    // busca local: escala e posição, passos cada vez menores
    for (const step of [16, 8, 4, 2, 1, 0.5]) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const [ds, du, dv] of [[0.06, 0, 0], [-0.06, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          if (fixed && ds) continue;
          const n = { ...t, s: t.s * (1 + ds * (step / 8)), u: t.u + du * step, v: t.v + dv * step };
          const ns = score(pts, mask, im, n);
          if (ns > sc + 1e-4) { t = n; sc = ns; moved = true; }
        }
      }
    }
    if (process.env.VERBOSE) process.stdout.write(` o${o}=${sc.toFixed(3)}`);
    if (!best || sc > best.score) best = { ...t, score: sc };
  }
  return best;
}

/** Pontos (X, Y) do log -> pixel (imagem de 1224 de largura) por `t` (rot, s, u, v, cx, cy), nas mesmas contas de `score`. */
function project(t, X, Y) {
  const [a, b, c, d] = mat(t);
  return [t.u + t.s * (a * (X - t.cx) + b * (Y - t.cy)), t.v + t.s * (c * (X - t.cx) + d * (Y - t.cy))];
}

/** Inversa de `project`: pixel -> (X, Y) do log. */
function unproject(t, u, v) {
  const [A, B, C, D] = mat(t);
  const det = A * D - B * C;
  const [du, dv] = [(u - t.u) / t.s, (v - t.v) / t.s];
  return [t.cx + (D * du - B * dv) / det, t.cy + (-C * du + A * dv) / det];
}

/**
 * Encaixe por lugares que o log fixa: semelhança com giro livre pelos pares (log x pixel), depois o refino pelas
 * paredes (mais pisões dentro do contorno) sem deixar nenhum par passar de `tol` jardas. Tudo na escala de 1224.
 * Devolve o equivalente a um `fixed` ({ rotation, s, u, v, cx, cy }) e o relatório.
 */
function fitAnchors(pairs, pts, mask, im) {
  if (pairs.length < 2) throw new Error('--anchors: precisa de 2 pares ou mais (3 para conferir)');
  // mapa = (-Y, X) (norte para cima); pixel com o v para cima (-v): então a semelhança é um giro sem espelho
  const sim = similarity(pairs.map((p) => [-p.log[1], p.log[0]]), pairs.map((p) => [p.px[0], -p.px[1]]));
  const free = (sim.theta * 180) / Math.PI;
  const { quarter, diff } = nearestQuarter(free);
  const cx = pairs.reduce((sum, p) => sum + p.log[0], 0) / pairs.length;
  const cy = pairs.reduce((sum, p) => sum + p.log[1], 0) / pairs.length;
  let t = { rot: diff <= 2 ? quarter : free, s: sim.s, u: 0, v: 0, cx, cy };
  // posição: o centro dos pares no log cai no centro dos pixels (é assim na semelhança por mínimos quadrados)
  const [mu, mv] = [(pairs.reduce((sum, p) => sum + p.px[0], 0) / pairs.length), pairs.reduce((sum, p) => sum + p.px[1], 0) / pairs.length];
  [t.u, t.v] = [mu, mv];
  const errors = (tt) => pairs.map((p) => Math.hypot(...project(tt, p.log[0], p.log[1]).map((q, i) => q - p.px[i])) / tt.s);
  const start = errors(t);
  const tol = Math.max(6, Math.max(...start));
  const k = WORK / MARK;
  const toWork = (tt) => ({ o: -1, rot: tt.rot, s: tt.s * k, u: tt.u * k, v: tt.v * k, cx: tt.cx, cy: tt.cy });
  const insideOf = (tt) => {
    const tw = toWork(tt);
    let n = 0;
    for (const [X, Y] of pts) { const [u, v] = project(tw, X, Y).map((q) => Math.round(q)); if (u >= 0 && v >= 0 && u < im.w && v < im.h && mask[v * im.w + u]) n++; }
    return n / pts.length;
  };
  // pisões dentro do contorno (o que as paredes dizem); a nota desempata e o erro médio dos pares segura o refino perto deles
  const eval1 = (tt) => (Math.max(...errors(tt)) > tol ? -1 : pts.length ? insideOf(tt) + 0.02 * score(pts, mask, im, toWork(tt)) - 0.004 * (errors(tt).reduce((x, y) => x + y, 0) / pairs.length) : 0);
  let sc = eval1(t);
  if (pts.length) {
    const levels = [[1, 0.02, 8], [0.5, 0.01, 4], [0.25, 0.005, 2], [0.1, 0.002, 1], [0.05, 0.001, 0.5], [0.02, 0.0005, 0.25]];
    for (const [dr, ds, dp] of levels) {
      let moved = true;
      while (moved) {
        moved = false;
        const moves = [[0, 0, 0, dp], [0, 0, 0, -dp], [0, 0, dp, 0], [0, 0, -dp, 0], [0, ds, 0, 0], [0, -ds, 0, 0]];
        if (diff > 2) moves.push([dr, 0, 0, 0], [-dr, 0, 0, 0]);
        for (const [mr, ms, mu2, mv2] of moves) {
          const n = { ...t, rot: t.rot + mr, s: t.s * (1 + ms), u: t.u + mu2, v: t.v + mv2 };
          const ns = eval1(n);
          if (ns > sc + 1e-4) { t = n; sc = ns; moved = true; }
        }
      }
    }
  }
  const after = errors(t);
  const marks = pairs.map((p, i) => ({ name: p.name, at: unproject(t, p.px[0], p.px[1]).map((q) => +q.toFixed(1)), err: after[i], before: start[i] }));
  const inside = pts.length ? insideOf(t) : null;
  return { fixed: { rotation: +t.rot.toFixed(2), s: +t.s.toFixed(4), u: +t.u.toFixed(2), v: +t.v.toFixed(2), cx: +t.cx.toFixed(2), cy: +t.cy.toFixed(2) }, free: { rotation: free, s: sim.s, errors: sim.residuals.map((r) => r / sim.s) }, marks, inside, snapped: diff <= 2 && diff > 0 ? { from: free, to: quarter } : null, multiple90: diff <= 2 };
}

/** Imagem de conferência: o chão escurecido fora, os pisões em vermelho. */
function check(a, im, mask, pts, t, file) {
  const out = Buffer.from(im.rgb);
  for (let p = 0; p < mask.length; p++) if (!mask[p]) for (let ch = 0; ch < 3; ch++) out[p * 3 + ch] = out[p * 3 + ch] >> 1;
  const [A, B, C, D] = mat(t);
  for (const [X, Y] of pts) {
    const u = Math.round(t.u + t.s * (A * (X - t.cx) + B * (Y - t.cy)));
    const v = Math.round(t.v + t.s * (C * (X - t.cx) + D * (Y - t.cy)));
    if (u < 0 || v < 0 || u >= im.w || v >= im.h) continue;
    const i = (v * im.w + u) * 3;
    out[i] = 255;
    out[i + 1] = 40;
    out[i + 2] = 40;
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${im.w}x${im.h}`, '-i', '-', file], { input: out });
}

/** Contorno do chão em coordenadas do log (para o app desenhar e saber o que é fora). */
function outline(a, im, t, mask) {
  const [A, B, C, D] = mat(t);
  // inversa: (u, v) -> (X, Y)
  const det = A * D - B * C;
  const toWorld = (u, v) => {
    const du = (u - t.u) / t.s;
    const dv = (v - t.v) / t.s;
    return [+(t.cx + (D * du - B * dv) / det).toFixed(1), +(t.cy + (-C * du + A * dv) / det).toFixed(1)];
  };
  const k = WORK / MARK;
  if (a.poly) return { poly: a.poly.map(([x, y]) => toWorld(x * k, y * k)), holes: (a.holes ?? []).map((h) => h.map(([x, y]) => toWorld(x * k, y * k))) };
  const circle = ([cx, cy, r]) => Array.from({ length: 32 }, (_, i) => toWorld(cx * k + r * k * Math.cos((i / 32) * 2 * Math.PI), cy * k + r * k * Math.sin((i / 32) * 2 * Math.PI)));
  if (a.disk) return { poly: circle(a.disk), holes: [circle(a.holeDisk)] };
  // chão pela cor: o contorno visto do meio (raios a partir do centro do chão, o ponto mais longe em cada um)
  let n = 0;
  let mu = 0;
  let mv = 0;
  for (let q = 0; q < mask.length; q++) if (mask[q]) { n++; mu += q % im.w; mv += (q / im.w) | 0; }
  mu /= n;
  mv /= n;
  const poly = [];
  for (let i = 0; i < 72; i++) {
    const ang = (i / 72) * 2 * Math.PI;
    let far = 0;
    for (let r = 0; r < im.w; r += 0.5) {
      const u = Math.round(mu + r * Math.cos(ang));
      const v = Math.round(mv + r * Math.sin(ang));
      if (u < 0 || v < 0 || u >= im.w || v >= im.h) break;
      if (mask[v * im.w + u]) far = r;
    }
    poly.push(toWorld(mu + far * Math.cos(ang), mv + far * Math.sin(ang)));
  }
  return { poly, holes: [] };
}

const ARENAS_JSON = process.env.ARENAS_JSON ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'arenas.json');
const anchorPairs = ANCHORS_FILE ? JSON.parse(fs.readFileSync(ANCHORS_FILE, 'utf8')) : null;
if (anchorPairs && !only) throw new Error('--anchors vale para uma arena: passe ARENA=<id do encounter>');

/** Texto curto de um valor para o diff (antes -> depois). */
function brief(key, v) {
  if (v === undefined) return '(novo)';
  if (key === 'floor') return `${v.length} pontos`;
  if (key === 'holes') return `${v.length} buraco(s)`;
  if (key === 'marks') return v.map((m) => `${m.name?.pt ?? m.name} [${m.at}]`).join('; ');
  return JSON.stringify(v);
}

/** Campos de data/arenas.json com os nomes do app. `rotation` só vem do encaixe quando ele sabe (fixed/anchors/orientação girada). */
function arenaFields(r, a, t, existing, anch) {
  const rot = t.rot != null ? +t.rot.toFixed(2) : ROTATION[t.o];
  const fields = {
    name: existing?.name ?? r.name,
    image: r.url,
    size: r.size,
    pxPerYd: r.sPx,
    anchorPx: [r.u0, r.v0],
    anchorAt: [r.cx, r.cy],
    fit: r.score,
    floor: r.floor.poly,
    holes: r.floor.holes,
  };
  if (rot !== 0 || t.rot != null) fields.rotation = rot;
  if (anch) {
    if (!anch.multiple90) fields.anchored = true;
    fields.marks = anch.marks.map((m, i) => ({
      name: typeof m.name === 'string' ? { pt: m.name, en: anchorPairs[i].en ?? m.name } : m.name,
      at: m.at,
      radius: anchorPairs[i].radius ?? 4,
      color: anchorPairs[i].color ?? ['#f97316', '#a78bfa', '#f43f5e', '#22d3ee', '#a3e635', '#facc15'][i % 6],
    }));
  }
  return fields;
}

const result = {};
let written = fs.readFileSync(ARENAS_JSON, 'utf8');
const existingArenas = JSON.parse(written).arenas;
let anyWrite = false;
for (const a0 of ARENAS) {
  if (only && a0.id !== only) continue;
  const o = occ[a0.id];
  if (!o) { console.log(a0.id, 'sem posições'); continue; }
  const im = decode(path.join(imgDir, `${a0.img}.jpg`));
  const mask = floorMask(a0, im);
  const pts = densePoints(o, a0.core);
  let a = a0;
  let anch = null;
  if (anchorPairs) {
    anch = fitAnchors(anchorPairs, pts, mask, im);
    a = { ...a0, fixed: anch.fixed };
    console.log(`--anchors (${anchorPairs.length} pares), semelhança livre: giro ${anch.free.rotation.toFixed(2)}°, ${(anch.free.s * 2).toFixed(3)} px/jd`);
    for (const [i, m] of anch.marks.entries()) console.log(`  ${String(m.name).padEnd(24)} erro ${anch.free.errors[i].toFixed(1)} jd (semelhança) -> ${m.err.toFixed(1)} jd (refino) · lugar no log [${m.at}]`);
    if (anch.snapped) console.log(`  giro a ${Math.abs(anch.snapped.from - anch.snapped.to).toFixed(2)}° de ${anch.snapped.to}: travado em ${anch.snapped.to}°`);
    console.log(`  fixed: ${JSON.stringify(anch.fixed)}${anch.inside == null ? '' : ` · pisões dentro ${(anch.inside * 100).toFixed(1)}%`}`);
  }
  const t = fit(pts, mask, im, a);
  check(a, im, mask, pts, t, path.join(outDir, `check-${a.id}.png`));
  // canto superior esquerdo e escala da imagem inteira no mundo (para desenhar o fundo)
  const k = im.origW / WORK;
  result[a.id] = {
    name: o.name,
    url: a.url,
    size: [im.origW, im.origH],
    orient: mat(t),
    // giro da imagem (o app gira a imagem para desenhar com o norte para cima)
    rotation: t.rot ?? ROTATION[t.o],
    // pixel (imagem original) = u0 + sPx * (orient · (X - cx, Y - cy))
    sPx: +(t.s * k).toFixed(4),
    u0: +(t.u * k).toFixed(1),
    v0: +(t.v * k).toFixed(1),
    cx: +t.cx.toFixed(2),
    cy: +t.cy.toFixed(2),
    score: +t.score.toFixed(3),
    floor: outline(a, im, t, mask),
  };
  console.log(a.id, o.name.padEnd(24), 'orient', t.o, 'px/yd', (t.s * k).toFixed(2), 'score', t.score.toFixed(3));
  if (WRITE) {
    const { text, changes } = patchArenaText(written, a.id, arenaFields(result[a.id], a, t, existingArenas[a.id], anch));
    written = text;
    anyWrite = anyWrite || changes.length > 0;
    console.log(`  --write ${path.relative(process.cwd(), ARENAS_JSON)}: ${changes.length ? '' : 'sem mudança'}`);
    for (const c of changes) {
      let extra = '';
      if ((c.key === 'floor' || c.key === 'holes') && c.before && c.before.length === c.after.length) {
        const flat = (v) => (c.key === 'floor' ? v : v.flat());
        const [b, n] = [flat(c.before), flat(c.after)];
        if (b.length === n.length) extra = ` (vértice mais movido ${Math.max(...b.map((p, i) => Math.hypot(p[0] - n[i][0], p[1] - n[i][1]))).toFixed(1)} jd)`;
      }
      console.log(`    ${c.key}: ${brief(c.key, c.before)} -> ${brief(c.key, c.after)}${extra}`);
    }
  }
}
fs.writeFileSync(path.join(outDir, 'arenas.json'), JSON.stringify(result, null, 1));
if (WRITE && anyWrite) fs.writeFileSync(ARENAS_JSON, written);
