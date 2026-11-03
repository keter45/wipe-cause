// Janela de tempo das timelines: zoom pela roda em volta do cursor, Shift/roda de lado para andar,
// segurar e arrastar, e o clique engolido depois de arrastar. Extraído de FightTimeline para ser
// usado também pela timeline dos CDs de cura.

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';

/** Menor trecho que o zoom da timeline mostra (ms). */
export const ZOOM_MIN_MS = 15_000;
/** Quanto cada passo da roda aproxima. */
export const ZOOM_STEP = 1.25;
/** Arrastar só começa depois disso (px): menos é clique. */
export const PAN_SLOP_PX = 4;

/** Zoom em volta de `at`, sem passar de [0, duration] nem do trecho mínimo. */
export function zoomAt(
  win: [number, number],
  duration: number,
  at: number,
  deltaY: number,
): [number, number] {
  const [a, b] = win;
  const w = Math.max(1, b - a);
  const nw = Math.min(duration, Math.max(ZOOM_MIN_MS, deltaY < 0 ? w / ZOOM_STEP : w * ZOOM_STEP));
  const ratio = Math.min(1, Math.max(0, (at - a) / w));
  const from = Math.min(Math.max(0, a + ratio * (w - nw)), Math.max(0, duration - nw));
  return [from, from + nw];
}

/** Anda a janela `dMs` sem passar de 0 nem de `duration`. */
export function panBy(win: [number, number], duration: number, dMs: number): [number, number] {
  const [a, b] = win;
  const w = Math.max(1, b - a);
  const from = Math.min(Math.max(0, a + dMs), Math.max(0, duration - w));
  return [from, from + w];
}

export interface TimeWindow {
  rootRef: RefObject<HTMLDivElement | null>;
  startPan: (e: PointerEvent<HTMLDivElement>) => void;
  panning: boolean;
  zoomed: boolean;
  swallowClick: (e: MouseEvent) => void;
}

/**
 * `win` fica no componente dono. O hook só escuta a roda/arrasto no `rootRef` e chama `onWin`;
 * `measure` devolve o elemento que serve de régua para a posição do cursor e a distância arrastada.
 */
export function useTimeWindow(o: {
  duration: number;
  win: [number, number];
  onWin: (w: [number, number]) => void;
  measure: () => HTMLElement | null;
}): TimeWindow {
  const { duration, win, onWin, measure } = o;
  const rootRef = useRef<HTMLDivElement>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const onWinRef = useRef(onWin);
  onWinRef.current = onWin;
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const [panning, setPanning] = useState(false);
  const dragged = useRef(false);

  // roda do mouse: zoom em volta do cursor; Shift (ou roda de lado): anda para os lados. Listener
  // nativo para poder impedir a rolagem da página.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const track = measureRef.current();
      if (!track) return;
      e.preventDefault();
      const r = track.getBoundingClientRect();
      const [a, b] = winRef.current;
      const w = b - a;
      const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (pan) {
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / Math.max(1, r.width)) * w;
        onWinRef.current(panBy(winRef.current, duration, d));
        return;
      }
      const at = a + Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * w;
      onWinRef.current(zoomAt(winRef.current, duration, at, e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [duration]);

  const zoomed = win[0] > 0 || win[1] < duration;

  // segurar e arrastar (em qualquer faixa, com zoom): anda para os lados. Um clique sem arrastar
  // continua indo para o instante (ou para o marcador clicado).
  const startPan = (ev: PointerEvent<HTMLDivElement>) => {
    if (!zoomed || ev.button !== 0) return;
    const track = measure() ?? ev.currentTarget;
    const r = track.getBoundingClientRect();
    const start = ev.clientX;
    const [a, b] = win;
    const w = b - a;
    let moved = false;
    const move = (e: globalThis.PointerEvent) => {
      if (!moved && Math.abs(e.clientX - start) < PAN_SLOP_PX) return;
      if (!moved) setPanning(true);
      moved = true;
      onWin(panBy([a, b], duration, ((start - e.clientX) / Math.max(1, r.width)) * w));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPanning(false);
      // o clique que vem logo depois do arrasto não conta
      dragged.current = moved;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const swallowClick = (e: MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return { rootRef, startPan, panning, zoomed, swallowClick };
}
