import { createContext, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Clapperboard, ImageDown, MessageSquare } from 'lucide-react';
import type { Pull } from '../types';
import { hasBackend } from '../lib/api';
import { fileSlug, saveClip, sendToDiscord } from '../lib/share';
import type { ClipMoment, ClipView } from '../lib/replayClip';
import { clockText, fitClipRange, MAX_CUSTOM_SPAN_MS, parseClock } from '../lib/clipSpan';
import { useSetup } from '../lib/setup';
import { useMessages } from '../i18n';
import { clipMsg } from './ClipButton.i18n';
import { Popover } from './Popover';
import { ZOOM_MIN, type MapView } from './ReplayView';

/** O pull aberto: os replays dentro dele ganham o botão de clipe. */
export const ClipPullContext = createContext<{ pull: Pull; title: string } | null>(null);

/** O controle de zoom do clipe vai até aqui (a roda do mouse vai mais longe). */
const ZOOM_SLIDER_MAX = 4;

interface Props {
  pull: Pull;
  title: string;
  /** o momento do clipe para o trecho escolhido (o rótulo e o instante do erro) */
  moment: (range: [number, number]) => ClipMoment;
  /** até onde o trecho pode ir (o replay na tela) */
  bounds: [number, number];
  /** o trecho do clipe (o escolhido ou o padrão) */
  range: [number, number];
  /** o usuário escolheu o trecho (senão é o padrão, em volta do instante) */
  custom: boolean;
  /** muda o trecho; null volta ao padrão */
  onRange: (r: [number, number] | null) => void;
  /** o instante do replay agora */
  now: () => number;
  /** o mapa na tela: o clipe sai igual */
  view: MapView;
  /** dá para trocar entre a raid toda e focado */
  canFrame: boolean;
  onWide: () => void;
  onZoom: (zoom: number) => void;
  /** o que o clipe repete do mapa da tela */
  clipView: () => ClipView;
}

/**
 * Botão "Clipe": o usuário escolhe o trecho (início e fim), o enquadramento (a raid toda ou focado) e o
 * zoom; enquadramento e zoom mudam o mapa da própria tela, que é a prévia. Depois gera o clipe (WebP
 * animado: o motor desenha o replay quadro a quadro) e oferece salvar ou mandar no Discord.
 */
export function ClipButton({ pull, title, moment, bounds, range, custom, onRange, now, view, canFrame, onWide, onZoom, clipView }: Props) {
  const t = useMessages(clipMsg);
  const { status } = useSetup();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [clip, setClip] = useState<{ bytes: Uint8Array; url: string; name: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(
    () => () => {
      if (clip) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  const setEnd = (which: 'from' | 'to', ms: number) => {
    const next: [number, number] = which === 'from' ? [ms, range[1]] : [range[0], ms];
    onRange(fitClipRange(next, bounds, which));
  };

  async function make() {
    setMsg(null);
    setProgress(0);
    try {
      const m = moment(range);
      // o motor (que desenha o próprio replay) só carrega aqui: sem import circular com o ReplayView
      const { replayClip } = await import('../lib/replayClip');
      const bytes = await replayClip(pull, m, { title, span: range, view: clipView(), onProgress: setProgress });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/webp' }));
      setClip({ bytes, url, name: `${fileSlug(`${title} ${m.label}`) || 'wipe-cause'}.webp` });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setProgress(null);
    }
  }

  async function act(kind: 'save' | 'discord') {
    if (!clip) return;
    setMsg(null);
    try {
      if (kind === 'save') {
        if (await saveClip(clip.bytes, clip.name)) setMsg({ ok: true, text: t.saved });
      } else {
        await sendToDiscord(title, { clip: { bytes: clip.bytes, name: clip.name } });
        setMsg({ ok: true, text: t.sent });
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  const busy = progress != null;
  const zoom = Math.min(ZOOM_SLIDER_MAX, view.cam.zoom);
  return (
    <span className="clip-menu">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t.title}
        trigger={
          <button className={`btn sm ghost ${open ? 'pressed' : ''}`} aria-expanded={open} title={t.title} aria-label={t.title} onClick={() => setOpen(!open)}>
            <Clapperboard size={14} strokeWidth={1.75} aria-hidden /> {t.button}
          </button>
        }
      >
        <div className="clip-panel">
          <fieldset className="clip-field" disabled={busy}>
            <legend className="small muted">{t.span}</legend>
            <div className="clip-range">
              <ClockInput label={t.start} value={range[0]} onChange={(ms) => setEnd('from', ms)} />
              <button className="btn sm ghost icon" onClick={() => setEnd('from', now())} title={t.startHere} aria-label={t.startHere}>
                <ArrowDownToLine size={14} strokeWidth={1.75} aria-hidden />
              </button>
              <span className="muted" aria-hidden>
                →
              </span>
              <ClockInput label={t.end} value={range[1]} onChange={(ms) => setEnd('to', ms)} />
              <button className="btn sm ghost icon" onClick={() => setEnd('to', now())} title={t.endHere} aria-label={t.endHere}>
                <ArrowUpToLine size={14} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <p className="small muted">
              <span className="num">{t.length((range[1] - range[0]) / 1000)}</span> · {t.maxLength(MAX_CUSTOM_SPAN_MS / 1000)}
              {custom && (
                <>
                  {' · '}
                  <button className="link small" onClick={() => onRange(null)}>
                    {t.reset}
                  </button>
                </>
              )}
            </p>
          </fieldset>
          {canFrame && (
            <fieldset className="clip-field" disabled={busy}>
              <legend className="small muted">{t.framing}</legend>
              <span className="segmented sm" role="radiogroup" aria-label={t.framing}>
                <button role="radio" aria-checked={view.wide} className={view.wide ? 'active' : ''} onClick={() => !view.wide && onWide()}>
                  {t.wide}
                </button>
                <button role="radio" aria-checked={!view.wide} className={!view.wide ? 'active' : ''} onClick={() => view.wide && onWide()}>
                  {t.focused}
                </button>
              </span>
            </fieldset>
          )}
          <fieldset className="clip-field" disabled={busy}>
            <legend className="small muted">{t.zoom}</legend>
            <span className="clip-zoom">
              <input type="range" min={ZOOM_MIN} max={ZOOM_SLIDER_MAX} step={0.1} value={zoom} aria-label={t.zoom} onChange={(e) => onZoom(Number(e.target.value))} />
              <span className="small num">{t.times(zoom)}</span>
            </span>
          </fieldset>
          <p className="small muted">{t.asOnScreen}</p>
          <button className="btn sm primary" onClick={() => void make()} disabled={busy}>
            <Clapperboard size={14} strokeWidth={1.75} aria-hidden /> {clip ? t.again : t.make}
          </button>
          {busy && (
            <p className="small muted">
              {t.making(Math.round(progress * 100))}
              <span className="clip-progress" aria-hidden>
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
            </p>
          )}
          {clip && <img className="clip-preview" src={clip.url} alt={t.preview} />}
          {clip && <p className="small muted">{t.size(clip.bytes.length / 1_000_000)}</p>}
          {clip && (
            <div className="clip-actions">
              <button className="btn sm" onClick={() => void act('save')}>
                <ImageDown size={14} strokeWidth={1.75} aria-hidden /> {t.save}
              </button>
              {hasBackend && status?.discord?.webhook && (
                <button className="btn sm" onClick={() => void act('discord')}>
                  <MessageSquare size={14} strokeWidth={1.75} aria-hidden /> {t.discord}
                </button>
              )}
            </div>
          )}
          {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
        </div>
      </Popover>
    </span>
  );
}

/** Tempo do pull editável ("1:23.4"): vale ao sair do campo ou com Enter. */
function ClockInput({ label, value, onChange }: { label: string; value: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(clockText(value));
  useEffect(() => setText(clockText(value)), [value]);
  const commit = () => {
    const ms = parseClock(text);
    if (ms == null) setText(clockText(value));
    else onChange(ms);
  };
  return (
    <input
      className="text-input sm num clip-clock"
      value={text}
      aria-label={label}
      title={label}
      inputMode="decimal"
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
