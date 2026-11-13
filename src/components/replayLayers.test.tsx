import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Waves } from './replayLayers';
import type { WaveView } from '../types';

const base: Omit<WaveView, 'key' | 'inferred' | 'from' | 'at'> = {
  name: 'Caustic Waves', spellId: 1, guid: 'E1', x: 0, y: 0, angles: [0], start: 0, speed: 13.5, width: 6, durationMs: 5000,
};
const inferred: WaveView = { ...base, key: 'tail', from: 1000, at: 1000, inferred: true };
const aura: WaveView = { ...base, key: 'aura', from: 0, at: 1000 };

function render(waves: WaveView[], now: number) {
  return renderToStaticMarkup(
    <Waves waves={waves} now={now} sx={(x) => x} sy={(y) => y} scale={1} clip="url(#x)" hidden={new Set()} labels posOf={() => [0, 0]} />,
  );
}

/** Abertura dos `<g>` ainda abertos onde começa a primeira tag com `cls` (sem DOM nos testes). */
function groupsAround(markup: string, cls: string): string[] {
  const at = markup.indexOf(`class="${cls}"`);
  if (at < 0) throw new Error(`sem ${cls}`);
  const open: string[] = [];
  for (const m of markup.slice(0, at).matchAll(/<g(?=[\s>])[^>]*>|<\/g>/g)) {
    if (m[0] === '</g>') open.pop();
    else open.push(m[0]);
  }
  return open;
}
const clipped = (groups: string[]) => groups.some((g) => g.includes('clip-path="url(#x)"'));

describe('Waves: onda inferida dos acertos', () => {
  it('não desenha nada antes de sair', () => {
    expect(render([inferred], 999)).toBe(render([], 999));
  });
  it('deixa a origem e o rastro fora do clip e a frente tracejada dentro', () => {
    const markup = render([inferred], 2000);
    expect(clipped(groupsAround(markup, 'replay-wave-origin'))).toBe(false);
    expect(clipped(groupsAround(markup, 'replay-wave-trail'))).toBe(false);
    const front = groupsAround(markup, 'replay-wave-front');
    expect(clipped(front)).toBe(true);
    expect(front.at(-1)).toContain('replay-wave--inferred');
    expect(markup).toContain('<title>Caustic Waves: direção inferida dos acertos</title>');
  });
  it('mantém a onda da aura como antes, sem ponto nem classe de inferida', () => {
    const markup = render([aura], 2000);
    expect(markup).not.toContain('replay-wave-origin');
    expect(markup).not.toContain('replay-wave--inferred');
    expect(clipped(groupsAround(markup, 'replay-wave-trail'))).toBe(true);
    expect(markup).toContain('<title>Caustic Waves</title>');
  });
});
