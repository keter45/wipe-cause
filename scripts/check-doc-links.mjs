// Confere os links entre os docs do repositório: todo link relativo aponta para um arquivo ou pasta
// que existe e, quando tem #âncora, para um título que existe no destino (slug como o do GitHub).
// Lê só o que o git não ignora: README.md, README.pt-BR.md, CLAUDE.md, docs/**/*.md (menos
// docs/releases/) e .claude/skills/*/SKILL.md. Links em código (entre crases ou em bloco cercado),
// http(s):, mailto: e links de referência [x][ref] ficam de fora.
//
//   npm run docs:links
//
// Imprime `arquivo:linha → alvo` por link quebrado e sai com código 1 se houver algum.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/checks.mjs';

const FENCE = /^\s*(```|~~~)/;

/** O texto com o código trocado por espaços (mesmo tamanho e mesmas quebras de linha), para os
 *  índices das linhas continuarem valendo. */
function maskCode(text) {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return ' '.repeat(line.length);
      }
      if (inFence) return ' '.repeat(line.length);
      return line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
    })
    .join('\n');
}

/** Slug de um título como o GitHub gera: minúsculas; sai tudo que não é letra, número, acento,
 *  espaço, `-` ou `_`; cada espaço vira `-` (sem juntar hífens nem cortar o do começo). */
export function slugify(title) {
  return title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

/** Os slugs dos títulos de um markdown, fora dos blocos cercados; o título repetido ganha -1, -2. */
export function headingSlugs(text) {
  const seen = new Map();
  const slugs = new Set();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const m = !inFence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n ? `${base}-${n}` : base);
  }
  return slugs;
}

/** Os links de um markdown, com a linha: [texto](alvo), ![alt](alvo), href="…" e src="…". */
export function extractLinks(text) {
  const masked = maskCode(text);
  const lineAt = (i) => masked.slice(0, i).split('\n').length;
  const links = [];
  const md = /!?\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g;
  const html = /\b(?:href|src)\s*=\s*"([^"]*)"/g;
  for (const re of [md, html]) {
    for (const m of masked.matchAll(re)) links.push({ target: m[1], line: lineAt(m.index) });
  }
  return links
    .filter((l) => l.target && !/^(https?:|mailto:)/i.test(l.target))
    .sort((a, b) => a.line - b.line);
}

/** Links quebrados de uma lista de arquivos (caminhos relativos a `root`). */
export function checkFiles(files, root = ROOT) {
  const slugCache = new Map();
  const slugsOf = (abs) => {
    if (!slugCache.has(abs)) slugCache.set(abs, headingSlugs(fs.readFileSync(abs, 'utf8')));
    return slugCache.get(abs);
  };
  const failures = [];
  for (const file of files) {
    const abs = path.join(root, file);
    for (const { target, line } of extractLinks(fs.readFileSync(abs, 'utf8'))) {
      const [rawPath, rawAnchor] = target.split('#');
      let dest;
      try {
        dest = rawPath ? path.resolve(path.dirname(abs), decodeURI(rawPath)) : abs;
      } catch {
        dest = path.resolve(path.dirname(abs), rawPath);
      }
      let ok = fs.existsSync(dest);
      if (ok && rawAnchor && dest.endsWith('.md') && fs.statSync(dest).isFile()) {
        let anchor = rawAnchor;
        try {
          anchor = decodeURIComponent(rawAnchor);
        } catch {}
        ok = slugsOf(dest).has(anchor.toLowerCase());
      }
      if (!ok) failures.push({ file, line, target });
    }
  }
  return failures;
}

/** Os docs que o git não ignora (versionados ou novos). */
export function docFiles(root = ROOT) {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (git.status !== 0) throw new Error(`git ls-files falhou: ${git.stderr}`);
  return [...new Set(git.stdout.split('\n').map((f) => f.trim()))]
    .filter((f) => fs.existsSync(path.join(root, f)))
    .filter(
      (f) =>
        ['README.md', 'README.pt-BR.md', 'CLAUDE.md'].includes(f) ||
        (f.startsWith('docs/') && f.endsWith('.md') && !f.startsWith('docs/releases/')) ||
        /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f),
    )
    .sort();
}

/** A linha que o relatório imprime para um link quebrado. */
export function formatFailure({ file, line, target }) {
  return `${file}:${line} → ${target}`;
}

function main() {
  const files = docFiles();
  const failures = checkFiles(files);
  for (const f of failures) console.log(formatFailure(f));
  console.log(`${files.length} docs, ${failures.length} link(s) quebrado(s)`);
  process.exitCode = failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
