import { describe, expect, it } from 'vitest';
import { arenaFor, toMap } from './arenas';

/** Onde um pixel da imagem cai no mapa, desenhado como o ReplayView: no canto (x0, y0), girado em volta dele. */
function pixelOnMap(m: NonNullable<ReturnType<typeof arenaFor>>, u: number, v: number, pxPerYd: number): [number, number] {
  // na tela (y para baixo) o pixel fica em canto + giro·(u, v); no mapa o y sobe
  const a = (m.rotate * Math.PI) / 180;
  const [dx, dy] = [u / pxPerYd, v / pxPerYd];
  const sx = dx * Math.cos(a) - dy * Math.sin(a);
  const sy = dx * Math.sin(a) + dy * Math.cos(a);
  return [m.x0 + sx, m.y0 - sy];
}

describe('arenaFor', () => {
  it('desenha a imagem sem giro quando o norte está em cima', () => {
    const m = arenaFor(3429)!;
    expect(m.rotate).toBe(0);
    expect(m.marks).toEqual([]);
  });

  it('gira a imagem com a sala (Vashnik, -58°) e a âncora cai onde o log diz', () => {
    const m = arenaFor(3455)!;
    expect(m.rotate).toBeCloseTo(-58.37, 2);
    // âncora: onde o boss fica e os Shrouded Venom nascem, (466; -329) no log
    const [x, y] = pixelOnMap(m, 1609.6, 1094.9, 9.3842);
    const [ex, ey] = toMap(466, -329);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
    // a fonte de sombra (embaixo à direita na imagem) fica a até 6 jd dali
    const shadow = m.marks.find((k) => k.color === '#a78bfa')!;
    const [px, py] = pixelOnMap(m, 1659, 1122, 9.3842);
    expect(Math.hypot(px - shadow.x, py - shadow.y)).toBeLessThan(0.5);
    expect(Math.hypot(shadow.x - ex, shadow.y - ey)).toBeLessThan(6.5);
  });
});
