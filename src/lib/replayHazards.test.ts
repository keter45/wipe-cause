import { describe, expect, it } from 'vitest';
import { blastPhase, groundContours } from './replayHazards';
import { decodeReplay } from './replay';

const kinds = [{ key: 'pool', spellId: 1, name: 'Pool', lingerMs: 3000, contourCellYd: 2 }];
const mark = (t: number, x = 0, y = 0) => ({ t, x, y, kind: 0 });

describe('pool contact contours', () => {
  it('merges cells without internal boundaries or duplicate samples', () => {
    const [contour] = groundContours({ groundKinds: kinds, ground: [mark(0), mark(0)] }, 0);
    expect(contour.cells).toHaveLength(9);
    expect(contour.edges).toHaveLength(12);
  });
  it('does not connect distant patches or include future contacts', () => {
    const [contour] = groundContours({ groundKinds: kinds, ground: [mark(0), mark(0, 100), mark(2000, 50)] }, 1000);
    expect(contour.cells).toHaveLength(18);
    expect(contour.edges).toHaveLength(24);
    expect(contour.cells.some(([column]) => column === 25)).toBe(false);
  });
  it('expires contacts and ignores missing or invalid sizes', () => {
    expect(groundContours({ groundKinds: kinds, ground: [mark(0)] }, 3001)).toEqual([]);
    for (const contourCellYd of [undefined, NaN, 0, -1, 0.1]) {
      expect(groundContours({ groundKinds: [{ ...kinds[0], contourCellYd }], ground: [mark(0)] }, 0)).toEqual([]);
    }
  });
});

describe('delayed blast phases', () => {
  it('decodes blast centers into map coordinates and accepts old reports', () => {
    const blast = { key: 'kiss', name: 'Kiss', spellId: 1, from: 1000, at: 7000, x: 10, y: 20, radius: 40, timingEstimated: false };
    expect(decodeReplay({ blasts: [blast] }).blasts).toEqual([{ ...blast, x: -20, y: 10 }]);
    expect(decodeReplay({}).blasts).toEqual([]);
  });
  it('only indicates impact at the explosion timestamp', () => {
    const blast = { from: 1000, at: 7000 };
    expect(blastPhase(blast, 999)).toBeNull();
    expect(blastPhase(blast, 1000)).toBe('warning');
    expect(blastPhase(blast, 6999)).toBe('warning');
    expect(blastPhase(blast, 7000)).toBe('impact');
    expect(blastPhase(blast, 8001)).toBeNull();
  });
});
