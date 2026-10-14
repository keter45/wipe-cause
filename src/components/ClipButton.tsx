import { createContext, useEffect, useState } from 'react';
import { Clapperboard, ImageDown, MessageSquare } from 'lucide-react';
import type { Pull } from '../types';
import { hasBackend } from '../lib/api';
import { fileSlug, saveClip, sendToDiscord } from '../lib/share';
import type { ClipMoment } from '../lib/replayClip';
import { useSetup } from '../lib/setup';
import { useMessages } from '../i18n';
import { clipMsg } from './ClipButton.i18n';
import { Popover } from './Popover';

/** O pull aberto: os replays dentro dele ganham o botão de clipe. */
export const ClipPullContext = createContext<{ pull: Pull; title: string } | null>(null);

/**
 * Botão "Clipe": gera o clipe (WebP animado) do trecho do replay (o motor desenha o replay quadro a quadro) e oferece
 * salvar ou mandar no Discord.
 */
export function ClipButton({ pull, moment, title, span }: { pull: Pull; moment: () => ClipMoment; title: string; span?: () => [number, number] }) {
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

  async function make() {
    setMsg(null);
    setProgress(0);
    try {
      const m = moment();
      // o motor (que desenha o próprio replay) só carrega aqui: sem import circular com o ReplayView
      const { replayClip } = await import('../lib/replayClip');
      const bytes = await replayClip(pull, m, { title, span: span?.(), onProgress: setProgress });
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

  return (
    <span className="clip-menu">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t.title}
        trigger={
          <button
            className={`btn sm ghost ${open ? 'pressed' : ''}`}
            aria-expanded={open}
            title={t.title}
            aria-label={t.title}
            onClick={() => {
              setOpen(!open);
              if (!open && !clip && progress == null) void make();
            }}
          >
            <Clapperboard size={14} strokeWidth={1.75} aria-hidden /> {t.button}
          </button>
        }
      >
        <div className="clip-panel">
          {progress != null && (
            <p className="small muted">
              {t.making(Math.round(progress * 100))}
              <span className="clip-progress" aria-hidden>
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
            </p>
          )}
          {clip && <img className="clip-preview" src={clip.url} alt={t.preview} />}
          {clip && (
            <p className="small muted">
              {t.size(clip.bytes.length / 1_000_000)}
            </p>
          )}
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
              <button className="btn sm ghost" onClick={() => void make()} disabled={progress != null}>
                {t.again}
              </button>
            </div>
          )}
          {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
        </div>
      </Popover>
    </span>
  );
}
