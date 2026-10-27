import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkFiles, extractLinks, headingSlugs, slugify } from './check-doc-links.mjs';

let dir;
function repo(files) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-links-'));
  for (const [name, text] of Object.entries(files)) {
    const abs = path.join(dir, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return dir;
}
afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

describe('slugify', () => {
  it('mantém acentos e tira pontuação', () => {
    expect(slugify('8. Cobertura da inspeção')).toBe('8-cobertura-da-inspeção');
  });
  it('tira o emoji e mantém o hífen do começo', () => {
    expect(slugify('📜 Rotation')).toBe('-rotation');
  });
  it('não junta hífens do travessão', () => {
    expect(slugify('a — b')).toBe('a--b');
  });
  it('mantém - e _ e usa o texto do link', () => {
    expect(slugify('snake_case e [Fluxo](x.md) no-meio')).toBe('snake_case-e-fluxo-no-meio');
  });
});

describe('headingSlugs', () => {
  it('numera o título repetido e ignora títulos em bloco cercado', () => {
    const slugs = headingSlugs('# Uso\n## Uso\n```sh\n# comentário\n```\n## Uso\n');
    expect([...slugs]).toEqual(['uso', 'uso-1', 'uso-2']);
  });
});

describe('extractLinks', () => {
  it('pega markdown, imagem e href/src com a linha', () => {
    const links = extractLinks('a [x](b.md)\n![i](img.png)\n<a href="c.md">c</a> <img src="d.png">');
    expect(links).toEqual([
      { target: 'b.md', line: 1 },
      { target: 'img.png', line: 2 },
      { target: 'c.md', line: 3 },
      { target: 'd.png', line: 3 },
    ]);
  });
  it('ignora código, http(s) e mailto', () => {
    const text = 'use `[x](a.md)`\n```md\n[y](b.md)\n```\n[w](https://x.dev) [m](mailto:a@b.c) [z](c.md)';
    expect(extractLinks(text)).toEqual([{ target: 'c.md', line: 5 }]);
  });
});

describe('checkFiles', () => {
  it('acusa arquivo inexistente com arquivo:linha', () => {
    const root = repo({ 'docs/a.md': '# A\n\n[x](nao-existe.md)\n' });
    expect(checkFiles(['docs/a.md'], root)).toEqual([{ file: 'docs/a.md', line: 3, target: 'nao-existe.md' }]);
  });
  it('confere a âncora no destino e no próprio arquivo', () => {
    const root = repo({
      'docs/a.md': '# Início\n[ok](b.md#8-cobertura-da-inspeção)\n[ruim](b.md#nada)\n[eu](#início)\n',
      'docs/b.md': '## 8. Cobertura da inspeção\n',
    });
    expect(checkFiles(['docs/a.md'], root)).toEqual([{ file: 'docs/a.md', line: 3, target: 'b.md#nada' }]);
  });
  it('aceita âncora codificada, de emoji e de título repetido', () => {
    const root = repo({
      'a.md': '[r](#-rotation) [e](#veja-em-a%C3%A7%C3%A3o) [d](#uso-1)\n### 📜 Rotation\n## Veja em ação\n## Uso\n## Uso\n',
    });
    expect(checkFiles(['a.md'], root)).toEqual([]);
  });
  it('aceita pasta como alvo', () => {
    const root = repo({ 'docs/a.md': '[src](../src)\n', 'src/x.ts': '' });
    expect(checkFiles(['docs/a.md'], root)).toEqual([]);
  });
});
