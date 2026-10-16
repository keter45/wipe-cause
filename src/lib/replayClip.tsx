// Clipe (WebP animado) do replay: o replay é desenhado fora da tela instante a instante, cada quadro
// vira imagem (com uma faixa em cima: o que foi e quanto falta para o erro), o canvas codifica cada
// um em WebP e webp.ts junta a animação. O clipe do pull mostra só as falhas gravíssimas e a causa
// do wipe, em ordem, cada um com um quadro de abertura; vai ao Discord junto com o cartão do wipe.
//
// O mapa é o mesmo da aba Replay: o pull relido sozinho no log (posições de todo mundo, mortes, áreas,
// orbs, defensivos em área, debuffs na cabeça). Sem o log, as posições guardadas no pull.

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { invoke } from './backend';
import type { Death, Pull, ReplayRef } from '../types';
import { inDesktop } from './api';
import { decodeReplay, deathReplayExtras, type ReplayData, type ReplayHit } from './replay';
import { wipeCause } from './verdict';
import { clipBounds } from './clipFraming';
import { fightView } from './fight';
import { canLoadFull, fightOverlays, headBadge, loadFullPull } from './fullReplay';
import * as prefs from './replayPrefs';
import { fetchTooltip, iconUrl } from './wowhead';
import { muxWebpAnimation, type WebpFrame } from './webp';
import { mmss, shortName } from './format';
import { messagesOf } from '../i18n';
import { clipLibMsg } from './replayClip.i18n';
import { EagerIcons } from '../components/SpellIcon';
import { ReplayView, type MapView, type Playback } from '../components/ReplayView';
import { clipSpan } from './clipSpan';

export { clipSpan };

/** Quadros por segundo. */
const FPS = 10;
/** Momentos do resumo: no máximo estes, e dois a menos disto (ms) um do outro viram um só. */
const MAX_MOMENTS = 4;
const SAME_MOMENT_MS = 5_000;
/** Largura do clipe (px), altura da faixa de cima e a qualidade de cada quadro (0-1). */
const WIDTH = 640;
const BAR = 30;
const QUALITY = 0.8;
const MIN_QUALITY = 0.45;
/** Quanto fica na tela (ms): a abertura do resumo, a de cada momento, o erro, o fim de um momento e o fim do clipe. */
const INTRO_MS = 2_600;
const CARD_MS = 1_300;
const AT_ERROR_MS = 900;
const MOMENT_END_MS = 500;
const CLIP_END_MS = 1_500;
/** Transição entre momentos: quadros da fusão. */
const FADE_FRAMES = 3;
/** O Discord recusa arquivos maiores (webhook sem Nitro). */
export const DISCORD_MAX_BYTES = 9_500_000;
/** O clipe mira neste tamanho (a qualidade baixa aos poucos se passar). */
const TARGET_BYTES = 7_000_000;

/** O que foi o momento: a causa do wipe ou outra falha gravíssima. */
export type ClipKind = 'trigger' | 'mistake';

/** Um trecho do pull para virar clipe. */
export interface ClipMoment {
  replay: ReplayRef;
  /** o instante do erro (marcado na faixa: "−2,1 s") */
  t: number;
  /** o que foi (aparece na faixa) */
  label: string;
  /** resumo da try: o tipo do momento (com cor e o rótulo curto) */
  kind?: ClipKind;
  /** habilidade do momento (ícone) */
  spellId?: number | null;
  /** mecânica da falha, para localizar sua origem no mapa */
  mechanicKey?: string;
  /** quem errou, quando é um só */
  who?: string;
  /** replay de morte: a vida e os golpes de quem morreu */
  death?: Death;
}

/**
 * O gatilho do wipe (a mecânica que puxou as mortes) e um replay que cubra esse instante (o da falha,
 * ou o da morte ligada a ela).
 */
function triggerMoment(p: Pull, deaths: Death[]): ClipMoment | null {
  const trig = wipeCause(p) ?? p.trigger;
  if (!trig) return null;
  const m = p.mechanics.find((x) => x.key === trig.key);
  const base = { label: trig.name, kind: 'trigger' as const, spellId: m?.spellId ?? null, mechanicKey: trig.key };
  const covers = (r?: ReplayRef) => !!r && r.from <= trig.t && r.to >= trig.t;
  const mech = (m?.replays ?? []).find(covers);
  if (mech) return { ...base, replay: mech, t: trig.t, who: whoOf(p, mech) };
  const linked = deaths.filter((d) => d.causedBy?.key === trig.key);
  const d = linked.find((x) => covers(x.replay)) ?? linked[0];
  if (d?.replay) return { ...base, replay: d.replay, t: covers(d.replay) ? trig.t : d.t, death: d };
  return null;
}

/** Quem o replay acompanha, quando é um só. */
function whoOf(p: Pull, r: ReplayRef): string | undefined {
  if (r.focus.length !== 1) return undefined;
  const name = p.players.find((x) => x.guid === r.focus[0])?.name;
  return name ? shortName(name) : undefined;
}

/**
 * Só a causa do wipe e as falhas de gravidade `wipe`. Erros graves/leves, mesmo marcados como
 * foco, e mortes isoladas não viram highlights. Sem causa ou falha gravíssima, não há clipe.
 * No máximo 4, em ordem de tempo; dois perto demais viram um só, com preferência pelo gatilho.
 */
export function clipMoments(p: Pull): ClipMoment[] {
  if (p.success) return [];
  const deaths = p.deaths.filter((d) => !d.ignored && d.replay).sort((a, b) => a.t - b.t);
  const picked: ClipMoment[] = [];
  const add = (m: ClipMoment | null) => {
    if (m && picked.length < MAX_MOMENTS && !picked.some((x) => Math.abs(x.t - m.t) < SAME_MOMENT_MS)) picked.push(m);
  };
  add(triggerMoment(p, deaths));
  const trig = picked[0]?.kind === 'trigger' ? (wipeCause(p) ?? p.trigger)?.key : undefined;
  const severe = p.mechanics
    .filter((m) => m.failures > 0 && m.key !== trig && m.replays?.length && m.severity === 'wipe')
    .sort((a, b) => Number(!!b.focus) - Number(!!a.focus) || (b.priority ?? 0) - (a.priority ?? 0));
  for (const m of severe) {
    const r = [...m.replays!].filter((r) => p.cutoffT == null || r.t <= p.cutoffT).sort((a, b) => a.t - b.t)[0];
    if (r) add({ replay: r, t: r.t, label: m.name, kind: 'mistake', spellId: m.spellId, mechanicKey: m.key, who: whoOf(p, r) });
  }
  return picked.sort((a, b) => a.t - b.t);
}

/** O mapa da tela que o clipe repete: enquadramento, câmera, os outros, e o trecho que o enquadramento cobre. */
export interface ClipView {
  view: MapView;
  /** o replay é a luta inteira (chão da arena, relógio em mm:ss) */
  full: boolean;
  frame?: [number, number];
}

export interface ClipOptions {
  /** título (ex.: "Pull 22 · The Coiled Altar"): na faixa do clipe de um momento e na abertura do resumo */
  title: string;
  /** trecho [de, até] (clipe de um momento só); sem ele, em volta do instante do erro */
  span?: [number, number];
  /** o mapa como o usuário deixou na tela (clipe de um momento só); sem ele, o enquadramento automático */
  view?: ClipView;
  onProgress?: (fraction: number) => void;
}

/** Arena: a imagem do raidplan vem pelo app (sem CORS, ela estragaria o canvas); no navegador, sem ela. */
async function withArenaImage(data: ReplayData): Promise<ReplayData> {
  if (!data.map) return data;
  if (!inDesktop) return { ...data, map: { ...data.map, image: '' } };
  try {
    const image = await invoke<string>('fetch_image', { url: data.map.image });
    return { ...data, map: { ...data.map, image } };
  } catch {
    return { ...data, map: { ...data.map, image: '' } };
  }
}

/** O pull com o replay completo (relido no log), ou o próprio se não der. */
async function fullOrSelf(pull: Pull): Promise<Pull> {
  if (!canLoadFull(pull)) return pull;
  try {
    return await loadFullPull(pull);
  } catch {
    return pull;
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

/**
 * Imagem carregada. Pelo `load`, não pelo `decode()`: com a janela escondida (o app na bandeja, no ao
 * vivo) o `decode()` não termina nunca, e o clipe (e o cartão que vai junto) ficaria parado.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('image not loaded'));
    img.src = src;
  });
}

/** Ícone (do Wowhead) de cada habilidade, para desenhar na faixa e nos quadros de abertura. */
async function iconImage(spellId: number | null | undefined, cache: Map<string, Promise<string>>): Promise<HTMLImageElement | null> {
  if (spellId == null || spellId <= 0) return null;
  try {
    const tip = await fetchTooltip(spellId);
    const data = tip?.icon ? await embed(iconUrl(tip.icon), cache) : '';
    return data ? await loadImage(data) : null;
  } catch {
    return null;
  }
}

/** Clipe (WebP animado) dos momentos do pull: um só (o replay aberto) ou o resumo da try. */
export async function replayClip(pull: Pull, list: ClipMoment | ClipMoment[], opts: ClipOptions): Promise<Uint8Array> {
  const moments = Array.isArray(list) ? list : [list];
  if (!moments.length) throw new Error('nothing to clip');
  const recap = moments.length > 1;
  const msg = messagesOf(clipLibMsg);
  // o mesmo mapa da aba Replay: o pull relido, com mortes, áreas, orbs, defensivos e debuffs na cabeça
  const src = await fullOrSelf(pull);
  const data = await withArenaImage(decodeReplay(src));
  const fv = fightView(src);
  const overlays = fv ? fightOverlays(src, fv, data) : null;
  const badge = fv ? headBadge(fv, prefs.hiddenHead(pull.encounterId)) : undefined;
  const classes = new Map(src.players.map((p) => [p.guid, p.class] as const));
  // com o replay completo, o trecho pode passar da janela guardada do replay (mostra o que veio depois do erro)
  const spans = moments.map((m) => (!recap && opts.span ? opts.span : clipSpan(fv ? { ...m.replay, from: 0, to: src.durationMs } : m.replay, m.t, recap)));
  // o mapa como na tela (clipe de um momento só, com o enquadramento e o zoom que o usuário escolheu)
  const screen = recap ? undefined : opts.view;
  // o mapa enquadra o trecho do clipe (onde a raid esteve nele)
  const replays = moments.map((m, i): ReplayRef => ({ ...m.replay, from: spans[i][0], to: spans[i][1] }));
  const bounds = moments.map((m, i) => screen ? undefined : clipBounds(data, m, spans[i], src.fight));
  const images = new Map<string, Promise<string>>();
  // ícones das habilidades na tela (casts dos bosses nos trechos): buscados antes, para não aparecerem no meio
  const ids = new Set<number>();
  for (const c of data.casts) if (spans.some(([a, b]) => c.t <= b && (c.end ?? c.t) >= a - 2000)) ids.add(c.spellId);
  for (const k of data.soaks) ids.add(k.spellId);
  for (const blast of data.blasts ?? []) ids.add(blast.spellId);
  for (const a of data.areas) if (a.spellId != null) ids.add(a.spellId);
  for (const z of overlays?.zones ?? []) ids.add(z.spellId);
  await Promise.all([...ids].map((id) => fetchTooltip(id).catch(() => null)));
  const icons = await Promise.all(moments.map((m) => iconImage(m.spellId, images)));

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;pointer-events:none;`;
  // fora da tela e sem foco (o replay pega o foco ao abrir; no ao vivo o usuário pode estar digitando)
  host.inert = true;
  document.body.appendChild(host);
  const root = createRoot(host);
  const draw = (i: number, now: number) => {
    const m = moments[i];
    const extras: { hits?: ReplayHit[]; hp?: [number, number][]; dies?: string } = m.death ? { ...deathReplayExtras(m.death), dies: m.death.guid } : {};
    // um só acompanhado sem morte: a vida dele no replay completo
    const one = m.replay.focus.length === 1 ? fv?.index.get(m.replay.focus[0]) : undefined;
    if (!extras.hp && one != null) extras.hp = fv!.data.hp[one];
    flushSync(() =>
      root.render(
        createElement(
          EagerIcons.Provider,
          { value: true },
          createElement(ReplayView, {
            key: i,
            data,
            replay: replays[i],
            classes,
            moment: m.death ? 'death' : 'failure',
            autoplay: false,
            playback: still(now),
            ...extras,
            ...(overlays ?? {}),
            badge,
            ...(screen ? { initial: screen.view, full: screen.full, frame: screen.frame } : { initial: { wide: false }, bounds: bounds[i] }),
          }),
        ),
      ),
    );
  };
  try {
    draw(0, spans[0][0]);
    // ícones (tooltip do Wowhead e depois a imagem) e a arena
    await pause(1500);
    const stage = () => host.querySelector('.replay-stage svg') as SVGSVGElement | null;
    let svg = stage();
    if (!svg) throw new Error('replay not drawn');
    // a altura máxima do mapa no app vem da janela (72vh): minimizada no ao vivo, seria zero
    svg.style.maxHeight = 'none';
    const box = svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + BAR;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const bg = color('--panel', '#171a21');
    const fg = color('--text', '#e6e8ee');
    const muted = color('--muted', '#8b93a5');
    const kindColor: Record<ClipKind, string> = { trigger: color('--wipe', '#e05656'), mistake: color('--wipe', '#e05656') };
    const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    const setFont = (size: number, weight = 600) => (ctx.font = `${weight} ${size}px ${font}`);

    // o tamanho: a qualidade baixa aos poucos se a média por quadro passar do que cabe
    const planned = spans.reduce((n, [a, b]) => n + Math.round((b - a) / (1000 / FPS)) + 1, 0) + moments.length * (FADE_FRAMES + 1) + 1;
    const budget = TARGET_BYTES / planned;
    let quality = QUALITY;
    let bytes = 0;
    const frames: WebpFrame[] = [];
    const push = async (delayMs: number) => {
      const webp = await webpOf(canvas, quality);
      frames.push({ webp, delayMs });
      bytes += webp.length;
      const avg = bytes / frames.length;
      if (avg > budget) quality = Math.max(MIN_QUALITY, quality - 0.05);
      else if (avg < budget * 0.6 && quality < QUALITY) quality = Math.min(QUALITY, quality + 0.05);
    };
    let done = 0;
    const progress = () => opts.onProgress?.(Math.min(1, ++done / planned));

    /** Texto com o ícone antes (a habilidade sempre com o ícone); devolve onde terminou. */
    const iconText = (text: string, x: number, y: number, size: number, icon: HTMLImageElement | null, maxW: number) => {
      if (icon) {
        ctx.drawImage(icon, x, y - size / 2, size, size);
        x += size + 6;
        maxW -= size + 6;
      }
      ctx.fillText(text, x, y, Math.max(20, maxW));
      return x + Math.min(ctx.measureText(text).width, maxW);
    };

    /** Faixa de cima: o que foi à esquerda; à direita, quanto falta para o erro (ou o tempo do pull depois dele). */
    const bar = (i: number, now: number) => {
      const m = moments[i];
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, BAR);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      setFont(13);
      const y = recap ? BAR / 2 - 1 : BAR / 2;
      let x = 10;
      if (m.kind) {
        ctx.fillStyle = kindColor[m.kind];
        const tag = `${msg.kind[m.kind]} · `;
        ctx.fillText(tag, x, y);
        x += ctx.measureText(tag).width;
      } else {
        ctx.fillStyle = fg;
        const head = `${opts.title} · `;
        ctx.fillText(head, x, y, w - 200);
        x += Math.min(ctx.measureText(head).width, w - 200);
      }
      ctx.fillStyle = fg;
      iconText(m.who ? `${m.label} · ${m.who}` : m.label, x, y, 16, icons[i], w - x - 80);
      const dt = now - m.t;
      ctx.fillStyle = dt < 0 ? fg : kindColor[m.kind ?? 'trigger'];
      ctx.textAlign = 'right';
      ctx.fillText(dt < 0 ? msg.toMoment(dt) : mmss(now), w - 10, y);
      ctx.textAlign = 'left';
      // resumo: um traço por momento (o atual enche com o tempo)
      if (recap) {
        const gap = 4;
        const seg = (w - 20 - gap * (moments.length - 1)) / moments.length;
        const [a, b] = spans[i];
        const k = Math.min(1, Math.max(0, (now - a) / Math.max(1, b - a)));
        for (let j = 0; j < moments.length; j++) {
          const sx = 10 + j * (seg + gap);
          ctx.fillStyle = muted;
          ctx.globalAlpha = 0.3;
          ctx.fillRect(sx, BAR - 4, seg, 2);
          ctx.globalAlpha = 1;
          const fill = j < i ? 1 : j === i ? k : 0;
          if (fill > 0) {
            ctx.fillStyle = fg;
            ctx.fillRect(sx, BAR - 4, seg * fill, 2);
          }
        }
      }
    };

    /** O mapa escurecido, para o texto dos quadros de abertura. */
    const dim = () => {
      ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
      ctx.fillRect(0, BAR, w, h);
    };

    /** Abertura do resumo: o pull e a lista dos momentos. */
    const intro = (shot: HTMLImageElement) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, BAR);
      ctx.drawImage(shot, 0, BAR, w, h);
      dim();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const rows = moments.length;
      const lineH = 30;
      const top = BAR + h / 2 - ((rows - 1) * lineH) / 2 - 22;
      const left = 48;
      setFont(19, 700);
      ctx.fillStyle = fg;
      ctx.fillText(opts.title, left, top - 26, w - left * 2);
      setFont(13);
      ctx.fillStyle = muted;
      ctx.fillText(msg.recap, left, top - 4, w - left * 2);
      moments.forEach((m, j) => {
        const y = top + 28 + j * lineH;
        setFont(14, 600);
        ctx.fillStyle = muted;
        ctx.fillText(mmss(m.t), left, y);
        let x = left + 48;
        ctx.fillStyle = kindColor[m.kind ?? 'trigger'];
        const tag = m.kind ? `${msg.kind[m.kind]} · ` : '';
        ctx.fillText(tag, x, y);
        x += ctx.measureText(tag).width;
        ctx.fillStyle = fg;
        iconText(m.who ? `${m.label} · ${m.who}` : m.label, x, y, 20, icons[j], w - x - left);
      });
    };

    /** Abertura de cada momento do resumo: o que foi, em grande, sobre o começo do trecho. */
    const card = (i: number, shot: HTMLImageElement) => {
      const m = moments[i];
      bar(i, spans[i][0]);
      ctx.drawImage(shot, 0, BAR, w, h);
      dim();
      const cx = w / 2;
      const cy = BAR + h / 2;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      setFont(13);
      ctx.fillStyle = muted;
      ctx.fillText(`${i + 1}/${moments.length} · ${msg.at(mmss(m.t))}`, cx, cy - 46);
      if (m.kind) {
        setFont(15, 700);
        ctx.fillStyle = kindColor[m.kind];
        ctx.fillText(msg.kind[m.kind].toUpperCase(), cx, cy - 22);
      }
      // ícone e nome, centralizados juntos
      setFont(21, 700);
      ctx.fillStyle = fg;
      const size = 26;
      const tw = Math.min(ctx.measureText(m.label).width, w - 80 - size);
      const icon = icons[i];
      const x0 = cx - (tw + (icon ? size + 8 : 0)) / 2;
      ctx.textAlign = 'left';
      iconText(m.label, x0, cy + 8, size, icon, w - 80);
      if (m.who) {
        ctx.textAlign = 'center';
        setFont(14, 600);
        ctx.fillStyle = fg;
        ctx.fillText(m.who, cx, cy + 38);
      }
      ctx.textAlign = 'left';
    };

    /** Cópia do quadro atual (para a fusão com o próximo). */
    const snapshot = () => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      c.getContext('2d')!.drawImage(canvas, 0, 0);
      return c;
    };

    let prev: HTMLCanvasElement | null = null;
    const step = 1000 / FPS;
    for (let i = 0; i < moments.length; i++) {
      const [from, to] = spans[i];
      const m = moments[i];
      if (i > 0) {
        draw(i, from);
        // o mapa de outro trecho: ícones novos e o layout
        await pause(400);
      }
      svg = stage() ?? svg;
      svg.style.maxHeight = 'none';
      if (recap) {
        const first = await svgImage(svg, w, h, images);
        if (i === 0) {
          intro(first);
          await push(INTRO_MS);
          progress();
          prev = snapshot();
        }
        card(i, first);
        const next = snapshot();
        // transição: o fim do momento anterior se funde na abertura deste
        if (prev) {
          for (let f = 1; f <= FADE_FRAMES; f++) {
            ctx.globalAlpha = 1;
            ctx.drawImage(prev, 0, 0);
            ctx.globalAlpha = f / (FADE_FRAMES + 1);
            ctx.drawImage(next, 0, 0);
            ctx.globalAlpha = 1;
            await push(60);
            progress();
          }
          ctx.drawImage(next, 0, 0);
        }
        await push(CARD_MS);
        progress();
      }
      const count = Math.max(1, Math.round((to - from) / step) + 1);
      for (let f = 0; f < count; f++) {
        const now = Math.min(to, from + f * step);
        // o flushSync já deixa o DOM pronto: sem esperar um temporizador (com a janela na bandeja, no ao
        // vivo, cada um demora até 1 s)
        draw(i, now);
        const shot = await svgImage(svg, w, h, images);
        bar(i, now);
        ctx.drawImage(shot, 0, BAR, w, h);
        // o erro: o quadro fica um pouco mais na tela
        const atError = Math.abs(now - m.t) < step / 2;
        await push(atError ? AT_ERROR_MS : step);
        progress();
      }
      frames[frames.length - 1].delayMs = i === moments.length - 1 ? CLIP_END_MS : MOMENT_END_MS;
      prev = snapshot();
    }
    let clip = muxWebpAnimation(w, h + BAR, frames);
    // grande demais para o Discord: metade dos quadros do replay (cada um fica o dobro do tempo; aberturas e pausas ficam)
    if (clip.length > DISCORD_MAX_BYTES) {
      const half: WebpFrame[] = [];
      for (let k = 0; k < frames.length; k++) {
        const f = frames[k];
        if (f.delayMs !== step) half.push(f);
        else if (k + 1 < frames.length && frames[k + 1].delayMs === step) {
          half.push({ ...f, delayMs: step * 2 });
          k++;
        } else half.push(f);
      }
      clip = muxWebpAnimation(w, h + BAR, half);
    }
    return clip;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** O quadro em WebP (o canvas do navegador codifica). */
async function webpOf(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', quality));
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
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
