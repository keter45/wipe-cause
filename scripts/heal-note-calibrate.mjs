// Calibra o limite do golpe da note de CDs de cura (docs/heal-cd-note.md) num relatório do wipe-cli:
// a distribuição do dano inevitável em 5 s pela vida máxima da raide sem tanks, quantos golpes e
// momentos cada limite daria, quantos golpes não têm marco e, com a note, quantos momentos têm CD.
// O desenvolvedor escolhe o limite (parâmetro da luta, calibrável nos nossos logs; G10 do design).
//
//   node scripts/heal-note-calibrate.mjs <relatório.json> [--boss "<nome>"] [--difficulty Mythic]
//        [--note note.txt] [--shares 0.6,0.7,0.8,0.9]
//
// Usa o próprio código do app (src/lib/raidHits.ts e healNoteCheck.ts), empacotado com o rolldown.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('uso: node scripts/heal-note-calibrate.mjs <relatório.json> [--boss "<nome>"] [--difficulty Mythic] [--note note.txt] [--shares 0.6,0.7,0.8,0.9]');
  process.exit(1);
}

// o código do app, sem o Vite
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const entry = path.join(os.tmpdir(), `heal-note-calibrate-entry-${process.pid}.ts`);
fs.writeFileSync(
  entry,
  ["export * from '" + path.join(root, 'src/lib/raidHits.ts').replace(/\\/g, '/') + "';", "export * from '" + path.join(root, 'src/lib/healNoteCheck.ts').replace(/\\/g, '/') + "';", "export * from '" + path.join(root, 'src/lib/healNote.ts').replace(/\\/g, '/') + "';"].join('\n'),
);
// as referências de healer (import.meta.glob do Vite) não entram na calibração
const noGlob = { name: 'no-glob', transform: (code) => (code.includes('import.meta.glob') ? code.replace(/import\.meta\.glob(<[^>]*>)?\(/g, '((..._) => ({}))(') : null) };
const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'silent', plugins: [noGlob] });
const { output } = await bundle.generate({ format: 'esm' });
const built = path.join(os.tmpdir(), `heal-note-calibrate-${process.pid}.mjs`);
fs.writeFileSync(built, output[0].code);
const lib = await import(pathToFileURL(built).href);
fs.rmSync(entry);
fs.rmSync(built);

const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const difficulty = opt('difficulty', 'Mythic');
const counts = new Map();
for (const p of report.pulls) if (p.difficultyName === difficulty) counts.set(p.encounterName, (counts.get(p.encounterName) ?? 0) + 1);
const boss = opt('boss', [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]);
const pulls = report.pulls.filter((p) => p.encounterName === boss && p.difficultyName === difficulty);
if (!pulls.length) {
  console.error(`nenhum pull de ${boss} ${difficulty}`);
  process.exit(1);
}
const withLife = pulls.filter((p) => p.raidSeries?.low);
console.log(`${boss} ${difficulty}: ${pulls.length} pulls, ${withLife.length} com a vida da raide no log`);

// distribuição do dano em 5 s / vida máxima
const ratios = [];
for (const p of withLife) {
  const s = p.raidSeries;
  for (let i = 0; i + 5 <= s.unavoidableK.length; i++) {
    if (!s.maxHpK[i]) continue;
    ratios.push(s.unavoidableK.slice(i, i + 5).reduce((a, b) => a + b, 0) / s.maxHpK[i]);
  }
}
ratios.sort((a, b) => a - b);
const q = (f) => ratios[Math.floor(f * (ratios.length - 1))] ?? 0;
console.log(`dano em 5 s / vida máxima: p50 ${q(0.5).toFixed(2)} · p75 ${q(0.75).toFixed(2)} · p90 ${q(0.9).toFixed(2)} · p95 ${q(0.95).toFixed(2)} · p99 ${q(0.99).toFixed(2)}`);

const notePath = opt('note');
const note = notePath ? lib.parseNote(fs.readFileSync(notePath, 'utf8').replace(/\r\n/g, '\n')) : null;
const names = new Map(pulls.flatMap((p) => p.enemySpells.map((e) => [e.spellId, e.name])));
const anchors = lib.nightAnchors(pulls);
const original = lib.STRONG_HIT_SHARE;
for (const share of opt('shares', '0.6,0.7,0.8,0.9').split(',').map(Number)) {
  // o limite é uma constante exportada: o script troca o valor no módulo empacotado
  const hits = new Map(pulls.map((p) => [p.id, lib.hits(p, anchors.get(p.id) ?? {}, share)]));
  const all = [...hits.values()].flat();
  const ms = lib.moments(pulls, anchors, hits);
  let line = `limite ${share.toFixed(2)}: ${all.length} golpes (${(all.length / Math.max(1, withLife.length)).toFixed(1)} por pull), ${all.filter((h) => !h.key).length} sem marco, ${ms.length} momentos`;
  if (note) {
    const offsets = lib.phaseOffsets(pulls, () => note);
    const checks = lib.matchLines(pulls, () => note, offsets);
    const v = lib.judgeUse(pulls, () => note, offsets, checks, ms);
    const covered = ms.filter((m) => [...m.pulls.keys()].some((id) => !v.get(id)?.uncovered.includes(m.key))).length;
    line += `, ${covered} com CD da note`;
  }
  console.log(line);
  if (share === original) for (const m of ms) console.log(`   ${m.phaseKey} +${Math.round(m.inPhaseMs / 1000)} s · ${names.get(m.spellId) ?? m.spellId} (${m.k}º ${names.get(m.anchorSpell) ?? m.anchorSpell}) · golpe em ${m.withHit} de ${m.pulls.size} · ${Math.round((m.medianSize ?? 0) * 100)}%`);
}
