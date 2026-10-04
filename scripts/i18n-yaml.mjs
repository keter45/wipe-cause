// Textos das regras de boss (encounters/) e das rotações (rotations/) nas duas línguas.
//
//   node scripts/i18n-yaml.mjs extract <saida.json>      textos ainda numa língua só: { "pt": "" }
//   node scripts/i18n-yaml.mjs apply <traducoes.json>    { "pt": "en" } -> `campo: { pt: "...", en: "..." }`
//
// O núcleo exige as duas línguas nos YAMLs embutidos (teste embedded_texts_are_bilingual); este
// script serve para converter arquivos antigos ou escritos numa língua só.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function yamls(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? yamls(p) : /\.ya?ml$/.test(e.name) ? [p] : [];
  });
}

/** Valor escalar de uma linha YAML (aspas duplas, simples ou texto puro sem comentário). */
function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith('{')) return null; // já está nas duas línguas
  if (v.startsWith('"')) return JSON.parse(v.match(/^"(?:[^"\\]|\\.)*"/)[0]);
  if (v.startsWith("'")) return v.match(/^'((?:[^']|'')*)'/)[1].replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
}

const both = (pt, en) => `{ pt: ${JSON.stringify(pt)}, en: ${JSON.stringify(en)} }`;

/** Cada texto de um arquivo: linha, valor e como trocá-lo pela versão nas duas línguas. */
function sites(lines) {
  const out = [];
  let section = '';
  lines.forEach((line, i) => {
    const top = line.match(/^([a-z_]+):/);
    if (top) section = top[1];
    let m;
    if (section === 'mechanics' && (m = line.match(/^(\s+)(tip|message|blame_message):\s*(.+)$/))) {
      const pt = scalar(m[3]);
      if (pt != null) out.push({ i, pt, put: (en) => `${m[1]}${m[2]}: ${both(pt, en)}` });
    } else if (section === 'checks' && (m = line.match(/^(\s+)(title|tip):\s*(.+)$/))) {
      const pt = scalar(m[3]);
      if (pt != null) out.push({ i, pt, put: (en) => `${m[1]}${m[2]}: ${both(pt, en)}` });
    } else if (section === 'key_points' && (m = line.match(/^(\s+-\s+)(.+)$/))) {
      const pt = scalar(m[2]);
      if (pt != null) out.push({ i, pt, put: (en) => `${m[1]}${both(pt, en)}` });
    } else if (section === 'priority' && (m = line.match(/note:\s*("(?:[^"\\]|\\.)*"|[^,}{]+)/))) {
      const pt = scalar(m[1]);
      if (pt != null) out.push({ i, pt, put: (en) => line.replace(m[0], `note: ${both(pt, en)}`) });
    }
  });
  return out;
}

const [mode, file] = process.argv.slice(2);
const files = [...yamls(path.join(root, 'encounters')), ...yamls(path.join(root, 'rotations'))];

if (mode === 'extract') {
  const all = {};
  for (const f of files) for (const s of sites(fs.readFileSync(f, 'utf8').split('\n'))) all[s.pt] = '';
  fs.writeFileSync(file, JSON.stringify(all, null, 1));
  console.log(`${Object.keys(all).length} textos únicos em ${files.length} arquivos -> ${file}`);
} else if (mode === 'apply') {
  const tr = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(eol);
    let changed = 0;
    for (const s of sites(lines)) {
      const en = tr[s.pt];
      if (!en) {
        missing.add(s.pt);
        continue;
      }
      lines[s.i] = s.put(en);
      changed++;
    }
    if (changed) fs.writeFileSync(f, lines.join(eol));
  }
  console.log(missing.size ? `sem tradução (${missing.size}):\n${[...missing].slice(0, 20).join('\n')}` : 'tudo traduzido');
} else {
  console.log('uso: node scripts/i18n-yaml.mjs extract|apply <arquivo.json>');
}
