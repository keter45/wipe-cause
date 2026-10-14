// Clipe (WebP animado) de um trecho do replay: o replay é desenhado fora da tela instante a instante,
// cada quadro vira imagem (com uma faixa em cima: o que foi e quanto falta para o erro), o canvas
// codifica cada um em WebP e webp.ts junta a animação. Serve para mandar no Discord os segundos do
// erro que acabou com a try.

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import type { Death, Pull, ReplayRef } from '../types';
import { inTauri } from './api';
import { decodeReplay, deathReplayExtras, type ReplayData, type ReplayHit } from './replay';
import { wipeCause } from './verdict';
import { muxWebpAnimation, type WebpFrame } from './webp';
import { mmss } from './format';
import { EagerIcons } from '../components/SpellIcon';
import { ReplayView, type Playback } from '../components/ReplayView';

/** Quadros por segundo e o maior trecho (ms) de um clipe. */
const FPS = 10;
const MAX_SPAN_MS = 12_000;
/** Trecho em volta do erro: tanto antes e tanto depois. */
const BEFORE_MS = 7_000;
const AFTER_MS = 3_000;
/** Largura do clipe (px), altura da faixa de cima e a qualidade de cada quadro (0-1). */
const WIDTH = 640;
const BAR = 30;
const QUALITY = 0.8;
/** O Discord recusa arquivos maiores (webhook sem Nitro). */
export const DISCORD_MAX_BYTES = 9_500_000;

/** Um trecho do pull para virar clipe. */
export interface ClipMoment {
  replay: ReplayRef;
  /** o instante do erro (marcado na faixa: "−2,1 s") */
  t: number;
  /** o que foi (aparece na faixa) */
  label: string;
  /** replay de morte: a vida e os golpes de quem morreu */
  death?: Death;
}

/**
 * O erro que acabou com a try: o gatilho do wipe (a mecânica que puxou as mortes) e um replay que
 * cubra esse instante (o da falha, ou o da morte ligada a ela); sem gatilho, a primeira morte.
 */
export function clipMoment(p: Pull): ClipMoment | null {
  if (p.success) return null;
  const trig = wipeCause(p) ?? p.trigger;
  const deaths = [...p.deaths].filter((d) => !d.ignored && d.replay).sort((a, b) => a.t - b.t);
  if (trig) {
    const m = p.mechanics.find((x) => x.key === trig.key);
    const linked = deaths.filter((d) => d.causedBy?.key === trig.key);
    const covers = (r?: ReplayRef) => !!r && r.from <= trig.t && r.to >= trig.t;
    const mech = (m?.replays ?? []).find(covers);
    if (mech) return { replay: mech, t: trig.t, label: trig.name };
    const d = linked.find((x) => covers(x.replay)) ?? linked[0];
    if (d?.replay) return { replay: d.replay, t: covers(d.replay) ? trig.t : d.t, label: trig.name, death: d };
  }
  const first = deaths[0];
  if (!first?.replay) return null;
  return { replay: first.replay, t: first.t, label: first.causedBy?.name ?? first.killingBlow?.spellName ?? first.name, death: first };
}

/** O trecho do clipe dentro do replay: em volta do erro, no máximo 12 s. */
export function clipSpan(r: ReplayRef, t: number): [number, number] {
  let from = Math.max(r.from, t - BEFORE_MS);
  let to = Math.min(r.to, t + AFTER_MS);
  if (to - from > MAX_SPAN_MS) from = to - MAX_SPAN_MS;
  if (to <= from) to = Math.min(r.to, from + 1000);
  return [from, to];
}

export interface ClipOptions {
  /** título na faixa (ex.: "Pull 22 · The Coiled Altar") */
  title: string;
  /** trecho [de, até]; sem ele, em volta do instante do erro */
  span?: [number, number];
  onProgress?: (fraction: number) => void;
}

/** Arena: a imagem do raidplan vem pelo app (sem CORS, ela estragaria o canvas); no navegador, sem ela. */
async function withArenaImage(data: ReplayData): Promise<ReplayData> {
  if (!data.map) return data;
  if (!inTauri) return { ...data, map: { ...data.map, image: '' } };
  try {
    const image = await invoke<string>('fetch_image', { url: data.map.image });
    return { ...data, map: { ...data.map, image } };
  } catch {
    return { ...data, map: { ...data.map, image: '' } };
  }
}

/** Tempo parado num instante (o clipe controla o relógio do replay). */
const still = (now: number): Playback => ({
  now,
  setNow: () => {},
  playing: false,
  setPlaying: () => {},
  speed: 1,
  setSpeed: () => {},
  nowRef: { current: now },
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clipe (WebP animado) do trecho `moment` do pull. */
export async function replayClip(pull: Pull, moment: ClipMoment, opts: ClipOptions): Promise<Uint8Array> {
  const data = await withArenaImage(decodeReplay(pull));
  const classes = new Map(pull.players.map((p) => [p.guid, p.class] as const));
  const extras: { hits?: ReplayHit[]; hp?: [number, number][]; dies?: string } = moment.death ? { ...deathReplayExtras(moment.death), dies: moment.death.guid } : {};
  const [from, to] = opts.span ?? clipSpan(moment.replay, moment.t);
  const replay: ReplayRef = { ...moment.replay };

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  const draw = (now: number) =>
    flushSync(() =>
      root.render(
        createElement(
          EagerIcons.Provider,
          { value: true },
          createElement(ReplayView, { data, replay, classes, moment: moment.death ? 'death' : 'failure', autoplay: false, playback: still(now), ...extras }),
        ),
      ),
    );
  try {
    draw(from);
    // ícones (tooltip do Wowhead e depois a imagem) e a arena
    await pause(1500);
    const svg = host.querySelector('.replay-stage svg') as SVGSVGElement | null;
    if (!svg) throw new Error('replay not drawn');
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + BAR;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--panel').trim() || '#171a21';
    const fg = css.getPropertyValue('--text').trim() || '#e6e8ee';
    const accent = css.getPropertyValue('--wipe').trim() || '#e05656';
    const frames: WebpFrame[] = [];
    const images = new Map<string, Promise<string>>();
    const step = 1000 / FPS;
    const count = Math.max(1, Math.round((to - from) / step) + 1);
    for (let i = 0; i < count; i++) {
      const now = Math.min(to, from + i * step);
      draw(now);
      await pause(0);
      const shot = await svgImage(svg, w, h, images);
      // faixa: o que foi à esquerda; à direita, quanto falta para o erro (ou o tempo do pull depois dele)
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, BAR);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fg;
      ctx.fillText(`${opts.title} · ${moment.label}`, 10, BAR / 2, w - 120);
      const dt = (now - moment.t) / 1000;
      const clock = dt < 0 ? `${dt.toFixed(1).replace('.', ',')} s` : mmss(now);
      ctx.fillStyle = dt < 0 ? fg : accent;
      ctx.textAlign = 'right';
      ctx.fillText(clock, w - 10, BAR / 2);
      ctx.textAlign = 'left';
      ctx.drawImage(shot, 0, BAR, w, h);
      // o erro: o quadro fica um pouco mais na tela
      const atError = Math.abs(now - moment.t) < step / 2;
      frames.push({ webp: await webpOf(canvas), delayMs: atError ? 900 : step });
      opts.onProgress?.((i + 1) / count);
    }
    // a última pausa antes de repetir
    frames[frames.length - 1].delayMs = 1500;
    let clip = muxWebpAnimation(w, h + BAR, frames);
    // grande demais para o Discord: metade dos quadros (cada um fica o dobro do tempo)
    if (clip.length > DISCORD_MAX_BYTES) {
      const half = frames.filter((_, i) => i % 2 === 0).map((f) => ({ ...f, delayMs: f.delayMs * 2 }));
      clip = muxWebpAnimation(w, h + BAR, half);
    }
    return clip;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** O quadro em WebP (o canvas do navegador codifica). */
async function webpOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', QUALITY));
  if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding not supported here');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Estilos que o SVG precisa levar junto (vêm do CSS do app; fora dele o SVG não os tem). */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-size',
  'font-weight',
  'font-family',
  'paint-order',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'display',
];

/** Imagem (ícone do Wowhead) embutida como data URL, uma vez por endereço. */
function embed(url: string, cache: Map<string, Promise<string>>): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => new Promise<string>((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result));
        fr.readAsDataURL(b);
      }))
      .catch(() => '');
    cache.set(url, p);
  }
  return p;
}

/**
 * O SVG do replay como imagem: uma cópia com os estilos calculados escritos em cada elemento e as
 * imagens embutidas (sem nada de fora, o canvas não fica "sujo" e dá para ler os pixels).
 */
async function svgImage(svg: SVGSVGElement, w: number, h: number, cache: Map<string, Promise<string>>): Promise<HTMLImageElement> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [copy, ...copy.querySelectorAll('*')];
  for (let i = 0; i < src.length; i++) {
    const cs = getComputedStyle(src[i]);
    (dst[i] as SVGElement).setAttribute('style', SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  }
  // o title vira texto solto em alguns leitores de SVG
  copy.querySelectorAll('title').forEach((t) => t.remove());
  await Promise.all(
    [...copy.querySelectorAll('image')].map(async (im) => {
      const href = im.getAttribute('href') ?? im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
      const data = href ? await embed(href, cache) : '';
      if (data) im.setAttribute('href', data);
      else im.remove();
    }),
  );
  copy.setAttribute('width', String(w));
  copy.setAttribute('height', String(h));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
