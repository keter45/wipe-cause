import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReplayView } from './ReplayView';
import { decodeReplay } from '../lib/replay';

function renderReplay(now: number, interrupted = false, framed = false) {
  const data = decodeReplay({
    tracks: { stepMs: 250, units: [
      { guid: 'P1', name: 'Player', kind: 'player', segs: [{ t0: 0, xy: Array.from({ length: 49 }, () => [100, 100]).flat() }] },
      { guid: 'B1', name: 'Boss', kind: 'enemy', segs: [{ t0: 0, xy: Array.from({ length: 49 }, (_, index) => [index > 20 ? 50 : 0, 0]).flat() }] },
    ] },
    casts: [{ guid: 'B1', t: 0, end: 5000, spellId: 1, name: 'Frontal', target: 'P1', facing: 0, interrupted, cone: { halfAngle: 35, range: 40 } }],
    blasts: [{ key: 'kiss', name: 'Kiss', spellId: 1283623, from: 1000, at: 7000, x: 0, y: 0, radius: 40, timingEstimated: false }],
    ground: { kinds: [{ key: 'pool', name: 'Pool', spellId: 1283290, lingerMs: 3000, contourCellYd: 2 }], marks: [[2000, 100, 100, 0]] },
  });
  return renderToStaticMarkup(<ReplayView data={data} replay={{ t: 7000, from: 0, to: 12000, focus: [], stacks: [], marks: [] }}
    classes={new Map()} moment="hit" autoplay={false} initial={{ wide: true }}
    bounds={framed ? [-24, 4, -4, 24] : undefined}
    playback={{ now, setNow: () => {}, playing: false, setPlaying: () => {}, speed: 1, setSpeed: () => {}, nowRef: { current: now } }} />);
}

describe('replay hazard rendering', () => {
  it('mantém a câmera do clipe na falha sem abrir para o raio inteiro da explosão', () => {
    const markup = renderReplay(3000, false, true);
    // O centro do player (-10, 10) fica no centro do mapa (360, 220).
    const player = markup.match(/<circle[^>]+class="posmap-player"[^>]*>/)?.[0];
    expect(player).toContain('cx="360"');
    expect(player).toContain('cy="220"');
    expect(renderReplay(3000)).not.toContain(player);
  });
  it('keeps the frontal warning throughout the cast, with impact only at its end', () => {
    for (const now of [0, 2500, 4999]) {
      const markup = renderReplay(now);
      expect(markup).toContain('class="replay-cone casting"');
      expect(markup).not.toContain('class="replay-cone impact"');
    }
    expect(renderReplay(5000)).toContain('class="replay-cone impact"');
  });
  it('never shows an interrupted frontal impact', () => {
    expect(renderReplay(2500, true)).toContain('class="replay-cone casting"');
    expect(renderReplay(5000, true)).not.toContain('class="replay-cone impact"');
  });
  it('keeps the impact origin fixed after the boss moves', () => {
    const polygon = (now: number) => renderReplay(now).match(/<polygon points="([^"]+)" data-phase="impact"/)?.[1];
    expect(polygon(5000)).toBeTruthy();
    expect(polygon(5250)).toBe(polygon(5000));
  });
  it('draws pool outlines and switches delayed circles from warning to impact', () => {
    expect(renderReplay(3000)).toContain('class="replay-pool-outline"');
    expect(renderReplay(3000)).toContain('class="replay-blast warning"');
    expect(renderReplay(7000)).toContain('class="replay-blast impact"');
    expect(renderReplay(7000)).not.toContain('class="replay-pool-outline"');
  });
});
