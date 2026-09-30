// Compara dois relatórios do wipe-cli (ex.: log local × Warcraft Logs) pull a pull.
// Ferramenta de desenvolvimento para validar a fonte Warcraft Logs.
//
//   node scripts/compare-reports.mjs local.json wcl.json

import fs from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const short = (n) => n?.split('-')[0];
const pct = (x, y) => (y === 0 ? (x === 0 ? 0 : 100) : Math.round(((x - y) / y) * 1000) / 10);
const issues = [];

for (const pa of a.pulls.filter((p) => !p.dungeon)) {
  const pb = b.pulls.find((p) => p.encounterId === pa.encounterId && Math.abs(p.startMs - pa.startMs) < 10_000);
  const title = `${pa.encounterName} #${pa.pullNumber} (${pa.success ? 'kill' : 'wipe'})`;
  if (!pb) {
    console.log(`✗ ${title}: não existe no segundo relatório`);
    continue;
  }
  const lines = [];
  const diff = (label, x, y, tol = 0) => {
    const d = typeof x === 'number' ? pct(y, x) : x === y ? 0 : 100;
    if (Math.abs(d) > tol) lines.push(`${label}: ${JSON.stringify(x)} → ${JSON.stringify(y)}${typeof x === 'number' ? ` (${d}%)` : ''}`);
  };
  if (Math.abs(pb.startMs - pa.startMs) > 3000) lines.push(`início Δ ${pb.startMs - pa.startMs} ms`);
  diff('duração', pa.durationMs, pb.durationMs, 1);
  diff('sucesso', pa.success, pb.success);
  diff('dificuldade', pa.difficultyId, pb.difficultyId);
  diff('players', pa.players.length, pb.players.length);
  diff('mortes', pa.deaths.length, pb.deaths.length);
  for (const da of pa.deaths) {
    const db = pb.deaths.find((d) => short(d.name) === short(da.name) && Math.abs(d.t - da.t) < 1500);
    if (!db) {
      lines.push(`morte de ${short(da.name)} em ${da.t} sumiu`);
      continue;
    }
    diff(`  golpe ${short(da.name)}`, `${da.killingBlow?.spellId}/${da.killingBlow?.source}`, `${db.killingBlow?.spellId}/${db.killingBlow?.source}`);
    const cause = (d) => d.causedBy?.key ?? d.killingBlowMechanic ?? d.deathKind;
    diff(`  causa ${short(da.name)}`, cause(da), cause(db));
    diff(`  recap ${short(da.name)}`, da.recap.length, db.recap.length, 20);
    const pos = (d) => d.positions?.units.find((u) => short(u.name) === short(d.name));
    const [xa, xb] = [pos(da), pos(db)];
    if (xa && xb && (Math.abs(xa.x - xb.x) > 3 || Math.abs(xa.y - xb.y) > 3)) lines.push(`  posição ${short(da.name)}: (${xa.x},${xa.y}) → (${xb.x},${xb.y})`);
  }
  for (const d of pb.deaths.filter((d) => !pa.deaths.some((x) => short(x.name) === short(d.name) && Math.abs(d.t - x.t) < 1500))) lines.push(`morte extra: ${short(d.name)} em ${d.t}`);
  for (const xa of pa.players) {
    const xb = pb.players.find((p) => short(p.name) === short(xa.name));
    if (!xb) {
      lines.push(`player ${xa.name} sumiu`);
      continue;
    }
    diff(`  nome ${short(xa.name)}`, xa.name, xb.name);
    diff(`  spec ${short(xa.name)}`, xa.specId, xb.specId);
    diff(`  dano ${short(xa.name)}`, xa.damageDone, xb.damageDone, 2);
    diff(`  cura ${short(xa.name)}`, xa.healingDone, xb.healingDone, 2);
    diff(`  tomado ${short(xa.name)}`, xa.damageTaken, xb.damageTaken, 2);
    diff(`  defensivos ${short(xa.name)}`, xa.defensivesUsed.length, xb.defensivesUsed.length);
    diff(`  interrupts ${short(xa.name)}`, xa.interrupts, xb.interrupts);
    diff(`  ilvl ${short(xa.name)}`, Math.round(xa.setup?.itemLevel ?? 0), Math.round(xb.setup?.itemLevel ?? 0));
  }
  for (const ma of pa.mechanics ?? []) {
    const mb = (pb.mechanics ?? []).find((m) => m.key === ma.key);
    diff(`  mecânica ${ma.key} falhas`, ma.failures?.length ?? 0, mb?.failures?.length ?? 0);
  }
  for (const [i, ba] of pa.bosses.entries()) diff(`  boss ${ba.name} hp`, Math.round(ba.hpPct ?? -1), Math.round(pb.bosses[i]?.hpPct ?? -1), 0);
  console.log(`${lines.length ? '≠' : '='} ${title}${lines.length ? '\n    ' + lines.join('\n    ') : ''}`);
  issues.push(...lines);
}
console.log(`\n${issues.length} diferenças`);
