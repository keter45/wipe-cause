import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nearestQuarter, patchArenaText, similarity } from './arenaMath.mjs';

const apply = (p, s, theta, t) => [s * (Math.cos(theta) * p[0] - Math.sin(theta) * p[1]) + t[0], s * (Math.sin(theta) * p[0] + Math.cos(theta) * p[1]) + t[1]];

describe('similarity', () => {
  const src = [[395, -287], [465, -329], [489.6, -206.8], [430, -250]];
  for (const deg of [-58.37, 0, 90, 135, -170]) {
    it(`recupera giro, escala e translação (${deg}°)`, () => {
      const theta = (deg * Math.PI) / 180;
      const dst = src.map((p) => apply(p, 9.38, theta, [1609.6, -1094.9]));
      const r = similarity(src, dst);
      expect((r.theta * 180) / Math.PI).toBeCloseTo(deg, 6);
      expect(r.s).toBeCloseTo(9.38, 8);
      expect(r.t[0]).toBeCloseTo(1609.6, 5);
      expect(r.t[1]).toBeCloseTo(-1094.9, 5);
      expect(Math.max(...r.residuals)).toBeLessThan(1e-6);
    });
  }

  it('com ruído nos pontos devolve o erro de cada par', () => {
    const theta = (-58 * Math.PI) / 180;
    const dst = src.map((p) => apply(p, 9.4, theta, [100, 50]));
    dst[1] = [dst[1][0] + 20, dst[1][1] - 10];
    const r = similarity(src, dst);
    expect(r.residuals).toHaveLength(4);
    expect(Math.max(...r.residuals)).toBeGreaterThan(5);
    expect((r.theta * 180) / Math.PI).toBeCloseTo(-58, -1);
  });

  it('recusa menos de 2 pares', () => {
    expect(() => similarity([[0, 0]], [[1, 1]])).toThrow();
  });
});

describe('nearestQuarter', () => {
  it('acha o múltiplo de 90 mais perto', () => {
    expect(nearestQuarter(-58.37)).toEqual({ quarter: -90, diff: expect.closeTo(31.63, 5) });
    expect(nearestQuarter(1.5)).toEqual({ quarter: 0, diff: 1.5 });
    expect(nearestQuarter(-0.4).quarter).toBe(0);
    expect(nearestQuarter(179).quarter).toBe(180);
  });
});

const SAMPLE = `{
 "_comment": "x",
 "arenas": {
  "3420": {
   "name": "A",
   "image": "u.jpg",
   "size": [2448, 1371],
   "pxPerYd": 12.0043,
   "anchorPx": [1220.8, 682.7],
   "anchorAt": [385.7, 408.27],
   "fit": 0.941,
   "offFloor": [1, 2],
   "floor": [
    [441.2, 430.8],
    [441.2, 385]
   ],
   "holes": []
  },
  "3455": {
   "name": "B",
   "floor": [[1, 2], [3, 4]],
   "holes": []
  }
 }
}
`;

describe('patchArenaText', () => {
  it('sem mudança deixa o texto igual', () => {
    const r = patchArenaText(SAMPLE, 3420, { name: 'A', size: [2448, 1371], pxPerYd: 12.0043, floor: [[441.2, 430.8], [441.2, 385]], holes: [] });
    expect(r.text).toBe(SAMPLE);
    expect(r.changes).toEqual([]);
  });

  it('muda só o campo que mudou e mantém o estilo e os campos à mão', () => {
    const r = patchArenaText(SAMPLE, 3420, { pxPerYd: 12.5, fit: 0.95 });
    expect(r.changes.map((c) => c.key)).toEqual(['pxPerYd', 'fit']);
    expect(r.text).toBe(SAMPLE.replace('12.0043', '12.5').replace('0.941', '0.95'));
    expect(JSON.parse(r.text).arenas['3420'].offFloor).toEqual([1, 2]);
  });

  it('floor em linha única continua em linha única; campo novo entra na ordem', () => {
    const r = patchArenaText(SAMPLE, 3455, { rotation: -58.37, anchored: true, marks: [{ name: { pt: 'a', en: 'b' }, at: [1, 2], radius: 4, color: '#fff' }], floor: [[1, 2], [3, 5]] });
    const j = JSON.parse(r.text).arenas['3455'];
    expect(Object.keys(j)).toEqual(['name', 'rotation', 'anchored', 'marks', 'floor', 'holes']);
    expect(r.text).toContain('   "floor": [[1, 2], [3, 5]],');
    expect(r.text).toContain('    { "name": { "pt": "a", "en": "b" }, "at": [1, 2], "radius": 4, "color": "#fff" }');
  });

  it('arena nova entra na ordem dos ids', () => {
    const r = patchArenaText(SAMPLE, 3430, { name: 'N', floor: [[0, 0], [1, 1]], holes: [] });
    expect(Object.keys(JSON.parse(r.text).arenas)).toEqual(['3420', '3430', '3455']);
    const last = patchArenaText(SAMPLE, 9999, { name: 'Z', holes: [] });
    expect(Object.keys(JSON.parse(last.text).arenas)).toEqual(['3420', '3455', '9999']);
  });

  it('data/arenas.json: reescrever cada arena com os próprios valores não muda nada', () => {
    const text = fs.readFileSync(new URL('../../data/arenas.json', import.meta.url), 'utf8');
    let out = text;
    const arenas = JSON.parse(text).arenas;
    for (const [id, a] of Object.entries(arenas)) out = patchArenaText(out, id, a).text;
    expect(out).toBe(text);
  });
});
