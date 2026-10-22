// Arena de cada boss no replay: a imagem de fundo (raidplan.io) alinhada com o combat log e o chão
// andável (data/arenas.json, calibrado por scripts/arena-fit.mjs).
//
// O replay desenha com o norte para cima, como o mapa do jogo, o raidplan e o Warcraft Logs: no
// log, X aponta para o norte e Y para o oeste, então a posição no mapa é (-Y, X). A imagem do raidplan
// segue a sala, e a sala pode estar girada no mundo (`rotation`: o Vashnik, -58°): o app gira a imagem.

import file from '../../data/arenas.json';
import type { Loc } from '../i18n';

/** Lugar fixo da sala com nome (as fontes do Vashnik): no log, raio em jardas, cor. */
interface ArenaMarkFile {
  name: Loc;
  at: [number, number];
  radius: number;
  color: string;
}

interface ArenaFile {
  image: string;
  /** giro da imagem na tela, em graus (0 = norte para cima na imagem) */
  rotation?: number;
  marks?: ArenaMarkFile[];
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
  /** onde fica o pixel (0, 0) da imagem (canto de cima à esquerda dela) e o tamanho dela (jardas) */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** giro da imagem em volta desse canto, em graus no sentido da tela (0 = norte em cima) */
  rotate: number;
  /** lugares fixos com nome, já no mapa */
  marks: { name: Loc; x: number; y: number; radius: number; color: string }[];
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
  // pixel -> mapa: (U, V) em jardas a partir da âncora na imagem; x = cos·U - sen·V, y = -sen·U - cos·V
  // (com giro 0: direita = +x do mapa, baixo = -y). O pixel (0, 0) é o canto em volta do qual a imagem gira.
  const rotate = a.rotation ?? 0;
  const [c, sn] = [Math.cos((rotate * Math.PI) / 180), Math.sin((rotate * Math.PI) / 180)];
  const [U, V] = [-a.anchorPx[0] / s, -a.anchorPx[1] / s];
  const [x0, y0] = [mx + c * U - sn * V, my - sn * U - c * V];
  return {
    image: a.image,
    x0,
    y0,
    rotate,
    marks: (a.marks ?? []).map((m) => {
      const [x, y] = toMap(m.at[0], m.at[1]);
      return { name: m.name, x, y, radius: m.radius, color: m.color };
    }),
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
