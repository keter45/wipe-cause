import type { ReplayData } from './replay';

export interface GroundContour {
  kind: number;
  cellYd: number;
  cells: [number, number][];
  edges: [number, number, number, number][];
}

export function groundContours(data: Pick<ReplayData, 'ground' | 'groundKinds'>, now: number): GroundContour[] {
  const contours: GroundContour[] = [];
  for (let kind = 0; kind < data.groundKinds.length; kind++) {
    const spec = data.groundKinds[kind];
    const cellYd = spec.contourCellYd;
    if (cellYd == null || !Number.isFinite(cellYd) || cellYd < 0.5) continue;
    const cells = new Map<string, [number, number]>();
    for (const mark of data.ground) {
      if (mark.kind !== kind || mark.t > now || now - mark.t > spec.lingerMs || !Number.isFinite(mark.x) || !Number.isFinite(mark.y)) continue;
      const column = Math.floor(mark.x / cellYd);
      const row = Math.floor(mark.y / cellYd);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const point: [number, number] = [column + dx, row + dy];
        cells.set(point.join(','), point);
      }
    }
    if (!cells.size) continue;
    const edges: GroundContour['edges'] = [];
    for (const [column, row] of cells.values()) {
      if (!cells.has([column, row - 1].join(','))) edges.push([column, row, column + 1, row]);
      if (!cells.has([column + 1, row].join(','))) edges.push([column + 1, row, column + 1, row + 1]);
      if (!cells.has([column, row + 1].join(','))) edges.push([column + 1, row + 1, column, row + 1]);
      if (!cells.has([column - 1, row].join(','))) edges.push([column, row + 1, column, row]);
    }
    contours.push({ kind, cellYd, cells: [...cells.values()], edges });
  }
  return contours;
}

export function blastPhase(blast: { from: number; at: number }, now: number): 'warning' | 'impact' | null {
  if (now < blast.from || now > blast.at + 1_000) return null;
  return now < blast.at ? 'warning' : 'impact';
}
