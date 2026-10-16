// Calibra a simulação dos fantasmas do Coiled Altar (gaze.rs) contra o que o log comprova:
// alcances (Dreadmarch sozinho no alvo), colisões (Malevolent Resonance) e fantasmas limpos por
// frontal (Soul Sever / Blighted Sever). Ferramenta de calibração (não roda no app):
//
//   WIPE_GAZE_DUMP=<pasta> cargo run --release --bin wipe-cli -- analyze <WoWCombatLog.txt>
//   node scripts/ghost-calibrate.mjs <pasta> [<pasta>...] [--grid=1 | --fine=1 | --p={"speed":4.5,...}]
//
// Mostra os erros com os parâmetros atuais do YAML e, com --grid/--fine, os melhores da grade.
// Simula sem âncoras (escala 1): é o que mostra se o modelo de andar/parar bate com o log.
import fs from 'fs';
import path from 'path';

const dirs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const pulls = [];
const seen = new Set();
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
    if (!d.log.fixes.length) continue;
    const key = d.log.fixes[0].ghost;
    if (seen.has(key)) continue;
    seen.add(key);
    pulls.push({ ...d.log, fail_times: d.fail_times, file: dir + '/' + f });
  }
}

const MAX_GAP = 1500, STEP = 100;
const CONES = { 1286620: [30, 45, 1307959], 1307292: [40, 40, 1307403] };

function stateAt(tr, t) {
  let lo = 0, hi = tr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr[m][0] <= t) lo = m + 1; else hi = m; }
  const i = lo;
  if (i === 0) return tr.length && tr[0][0] - t <= MAX_GAP ? [tr[0][1], tr[0][2], tr[0][3]] : null;
  const a = tr[i - 1], b = tr[i];
  if (b && b[0] - a[0] <= 3000) { const k = (t - a[0]) / Math.max(1, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3]]; }
  return [a[1], a[2], a[3]];
}
const angOff = (gx, gy, px, py, f) => { const a = Math.atan2(gy - py, gx - px) - f; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); };

// p: {speed, half, delay, stun, mode}; mode 'cone' (padrão) ou 'front' (meio-plano)
function simulate(p, pull, fx, until) {
  const tr = pull.trails[fx.player] || [];
  const half = p.half * Math.PI / 180;
  let x = fx.x, y = fx.y, seen = -1e15, reached = null;
  const pts = [[fx.from, x, y]];
  let t = fx.from;
  while (t < until) {
    const next = Math.min(t + STEP, until);
    const step = p.speed * (next - t) / 1000;
    t = next;
    const s = stateAt(tr, t);
    if (s) {
      const [px, py, f] = s;
      if (angOff(x, y, px, py, f) <= half) seen = t;
      const d = Math.hypot(px - x, py - y);
      if (t - fx.from >= p.delay && t - seen > p.stun && d > 0) { const m = Math.min(step, d); x += (px - x) / d * m; y += (py - y) / d * m; }
      if (reached === null && t - fx.from >= p.delay && Math.hypot(px - x, py - y) < 1) reached = t;
    }
    pts.push([t, x, y]);
  }
  return { pts, reached };
}
const at = (pts, t) => { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m + 1; else hi = m; } const q = pts[Math.max(0, lo - 1)]; return [q[1], q[2]]; };

function evaluate(p, verbose = false) {
  const m = { catchErr: [], catchEarly: 0, catchN: 0, collErr: [], sevIn: 0, sevN: 0, sevFalse: 0, sevAlive: 0, falseCatch: 0, walked: 0 };
  for (const pull of pulls) {
    const sims = pull.fixes.map(fx => {
      const end = fx.to ?? pull.last_t;
      if (end - fx.from < 500) return null;
      return { fx, end, ...simulate(p, pull, fx, end) };
    });
    // alcances
    for (const s of sims) {
      if (!s) continue;
      const { fx, end } = s;
      const solo = t => pull.catches.filter(c => Math.abs(c[0] - t) <= 300).length === 1;
      const c = pull.catches.filter(c => c[1] === fx.player && c[0] >= fx.from && fx.to != null && Math.abs(c[0] - fx.to) <= 400 && solo(c[0]))
        .sort((a, b) => Math.abs(a[0] - fx.to) - Math.abs(b[0] - fx.to))[0];
      const cleared = pull.clears.some(c => c[1] === fx.ghost && Math.abs(c[0] - end) <= 50);
      if (c) {
        const ta = Math.min(c[0], fx.to);
        const st = stateAt(pull.trails[fx.player] || [], ta);
        if (!st) continue;
        const [gx, gy] = at(s.pts, ta);
        m.catchErr.push(Math.hypot(gx - st[0], gy - st[1]));
        m.catchN++;
        if (s.reached !== null && s.reached < ta - 1500) m.catchEarly++;
      } else if (s.reached !== null && s.reached < end - 1500 && !cleared && fx.to != null) {
        m.falseCatch++;
      }
      let w = 0; for (let i = 1; i < s.pts.length; i++) w += Math.hypot(s.pts[i][1] - s.pts[i - 1][1], s.pts[i][2] - s.pts[i - 1][2]);
      m.walked += w;
    }
    // colisões
    for (const ft of pull.fail_times) {
      const who = [...new Set(pull.hits.filter(h => Math.abs(h[0] - ft) <= 500).map(h => h[1]))];
      const live = sims.filter(s => s && who.includes(s.fx.player) && s.fx.from <= ft && (s.fx.to == null || s.fx.to >= ft - 500));
      let best = Infinity;
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = at(live[i].pts, ft), b = at(live[j].pts, ft);
        best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      if (best < Infinity) m.collErr.push(best);
    }
    // frontais que limpam fantasmas
    for (const c of pull.casts.filter(c => CONES[c[1]])) {
      const [half, range, aura] = CONES[c[1]];
      const [, , bx, by, bf] = c;
      for (const s of sims) {
        if (!s || s.fx.from > c[0] || s.end < c[0] - 50) continue;
        const hit = pull.clears.some(k => k[1] === s.fx.ghost && k[2] === aura && Math.abs(k[0] - c[0]) <= 300);
        const [gx, gy] = at(s.pts, c[0]);
        const inside = Math.hypot(gx - bx, gy - by) <= range && angOff(gx, gy, bx, by, bf) <= half * Math.PI / 180;
        if (hit) { m.sevN++; if (inside) m.sevIn++; } else if (s.end > c[0] + 300) { m.sevAlive++; if (inside) m.sevFalse++; }
      }
    }
  }
  const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const r = {
    catchMed: med(m.catchErr), catchMean: mean(m.catchErr), catchN: m.catchN, catchEarly: m.catchEarly, falseCatch: m.falseCatch,
    collMed: med(m.collErr), collMean: mean(m.collErr), collN: m.collErr.length,
    sevHit: `${m.sevIn}/${m.sevN}`, sevFalse: `${m.sevFalse}/${m.sevAlive}`, walked: Math.round(m.walked),
  };
  // custo: erros em jardas (limitados), falsos alcances e limpezas fora do cone
  r.cost = mean(m.catchErr.map(e => Math.min(e, 30))) + mean(m.collErr.map(e => Math.min(e, 30)))
    + 10 * (m.catchEarly + m.falseCatch) / Math.max(1, m.catchN)
    + 10 * (1 - m.sevIn / Math.max(1, m.sevN)) + 10 * m.sevFalse / Math.max(1, m.sevAlive);
  return r;
}

console.log(`pulls ${pulls.length}, fixações ${pulls.reduce((s, p) => s + p.fixes.length, 0)}, colisões ${pulls.reduce((s, p) => s + p.fail_times.length, 0)}`);
const base = { speed: 4.5, half: 30, delay: 2000, stun: 500 };
console.log('atual', base, evaluate(base));
if (flags.grid) {
  const res = [];
  for (const speed of [3, 3.5, 4, 4.5, 5, 6, 7])
    for (const half of [20, 35, 45, 60, 75, 90])
      for (const delay of [0, 1000, 2000, 2500, 3000, 4000])
        for (const stun of [0, 500, 1000, 1500, 2500]) {
          const p = { speed, half, delay, stun };
          res.push({ p, r: evaluate(p) });
        }
  res.sort((a, b) => a.r.cost - b.r.cost);
  for (const x of res.slice(0, 15)) console.log(JSON.stringify(x.p), JSON.stringify(x.r));
}
if (flags.fine) {
  const res = [];
  for (const speed of [4, 4.25, 4.5, 4.75, 5, 5.5])
    for (const half of [30, 35, 40])
      for (const delay of [1500, 2000, 2500, 3000])
        for (const stun of [0, 250, 500, 750]) {
          const p = { speed, half, delay, stun };
          res.push({ p, r: evaluate(p) });
        }
  res.sort((a, b) => a.r.cost - b.r.cost);
  for (const x of res.slice(0, 10)) console.log(JSON.stringify(x.p), x.r.cost.toFixed(2), x.r.catchMed.toFixed(1), x.r.collMed.toFixed(1), x.r.sevHit, x.r.sevFalse, x.r.falseCatch);
}
if (flags.p) { const p = JSON.parse(flags.p); console.log(p, evaluate(p)); }
