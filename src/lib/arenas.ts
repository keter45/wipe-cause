// Arena de cada boss no replay: a imagem de fundo (raidplan.io) alinhada com o combat log e o chão
// andável (data/arenas.json, calibrado por scripts/arena-fit.mjs).
//
// O replay desenha com o norte para cima, como o mapa do jogo, o raidplan e o Warcraft Logs: no
// log, X aponta para o norte e Y para o oeste, então a posição no mapa é (-Y, X).

import file from '../../data/arenas.json';

interface ArenaFile {
  image: string;
  size: [number, number];
  pxPerYd: number;
  anchorPx: [number, number];
  anchorAt: [number, number];
  floor: [number, number][];
  holes: [number, number][][];
}

/** Arena em coordenadas do mapa (jardas, norte para cima). */
export interface ArenaMap {
  image: string;
  /** canto de cima à esquerda da imagem e o tamanho dela (jardas) */
  x0: number;
  y0: number;
  w: number;
  h: number;
  floor: [number, number][];
  holes: [number, number][][];
}

/** Posição do log -> mapa com o norte para cima. */
export const toMap = (x: number, y: number): [number, number] => [-y, x];
/** Direção do log (radianos, a partir do +X) -> no mapa. */
export const facingToMap = (f: number) => f + Math.PI / 2;

const arenas = (file as unknown as { arenas: Record<string, ArenaFile> }).arenas;

export function arenaFor(encounterId: number): ArenaMap | undefined {
  const a = arenas[encounterId];
  if (!a) return undefined;
  const [mx, my] = toMap(a.anchorAt[0], a.anchorAt[1]);
  const s = a.pxPerYd;
  const pt = ([x, y]: [number, number]) => toMap(x, y);
  return {
    image: a.image,
    // na imagem: direita = +x do mapa, baixo = -y do mapa
    x0: mx - a.anchorPx[0] / s,
    y0: my + a.anchorPx[1] / s,
    w: a.size[0] / s,
    h: a.size[1] / s,
    floor: a.floor.map(pt),
    holes: a.holes.map((h) => h.map(pt)),
  };
}

/** Ponto dentro do chão andável (dentro do contorno e fora dos buracos)? */
export function onFloor(m: ArenaMap, x: number, y: number): boolean {
  const inside = (poly: [number, number][]) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
  };
  return inside(m.floor) && !m.holes.some(inside);
}
