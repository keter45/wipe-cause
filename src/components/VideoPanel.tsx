import { useEffect, useRef, useState } from 'react';
import { Cloud, Play, Video, X } from 'lucide-react';
import { PlayerName } from './Names';
import { videoSrc, type WcrVideo } from '../lib/api';
import { LEAD_MS } from '../lib/wcr';
import { mmss } from '../lib/format';
import { useMessages } from '../i18n';
import { videoMsg } from './VideoPanel.i18n';

interface Props {
  /** POVs do pull: este PC e a nuvem da guilda */
  povs: WcrVideo[];
  video: WcrVideo;
  onPov: (v: WcrVideo) => void;
  /** pedido de seek: `n` muda a cada clique, mesmo repetindo o mesmo `t` */
  seek: { t: number; n: number } | null;
  onClose: () => void;
}

/**
 * Player do vídeo do Warcraft Recorder; o tempo do vídeo = tempo do pull. Com mais de um POV,
 * trocar mantém o momento: a mesma cena vista por outra pessoa da raid.
 */
export function VideoPanel({ povs, video, onPov, seek, onClose }: Props) {
  const t = useMessages(videoMsg);
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // troca de POV: continua do mesmo segundo
  const resumeAt = useRef<number | null>(null);
  useEffect(() => {
    setError(false);
    videoSrc(video.videoPath).then(setSrc);
  }, [video.videoPath]);
  const switchTo = (v: WcrVideo) => {
    if (v === video) return;
    resumeAt.current = ref.current?.currentTime ?? null;
    onPov(v);
  };
  const onLoaded = () => {
    const v = ref.current;
    if (v && resumeAt.current != null) {
      v.currentTime = resumeAt.current;
      resumeAt.current = null;
      v.play().catch(() => {});
    }
  };

  useEffect(() => {
    const v = ref.current;
    if (!v || !seek || !src) return;
    const go = () => {
      v.currentTime = Math.max(0, (seek.t - LEAD_MS) / 1000);
      v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
  }, [seek, src]);

  return (
    <section className="video-panel">
      <header>
        <span className="pov-head">
          <Video size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.povOf}
          {povs.length > 1 ? (
            <span className="pov-list" role="group" aria-label={t.pointOfView}>
              {povs.map((v) => (
                <button
                  key={v.videoPath}
                  className={`pov ${v === video ? 'active' : ''}`}
                  onClick={() => switchTo(v)}
                  aria-pressed={v === video}
                  title={v.cloud ? t.cloudVideo : t.localVideo}
                >
                  {v.cloud && <Cloud size={12} strokeWidth={1.75} aria-label={t.cloud} />}
                  {v.player ? <PlayerName name={v.player} /> : '?'}
                </button>
              ))}
            </span>
          ) : (
            <strong> {video.player ? <PlayerName name={video.player} /> : '?'}</strong>
          )}
          {seek && <span className="muted">{t.goingTo(mmss(Math.max(0, seek.t - LEAD_MS)))}</span>}
        </span>
        <button className="icon-btn" onClick={onClose} title={t.close} aria-label={t.close}>
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </header>
      {error ? (
        <p className="muted small">
          {video.cloud ? (
            t.cloudError
          ) : (
            <>
              {t.localError} <code>{video.videoPath}</code>
            </>
          )}
        </p>
      ) : (
        src && <video ref={ref} src={src} controls preload="metadata" onLoadedMetadata={onLoaded} onError={() => setError(true)} />
      )}
    </section>
  );
}

/** Botão "play" que pula o vídeo para `t`; some quando o pull não tem vídeo. */
export function PlayAt({ t, seek, label }: { t: number; seek: ((t: number) => void) | null; label?: string }) {
  const m = useMessages(videoMsg);
  if (!seek) return null;
  return (
    <button
      className="play"
      aria-label={label ?? m.watch}
      title={m.watchAt(mmss(Math.max(0, t - LEAD_MS)))}
      onClick={(e) => {
        e.stopPropagation();
        seek(t);
      }}
    >
      <Play size={11} strokeWidth={2} aria-hidden />
      {label && <span>{label}</span>}
    </button>
  );
}
