import { useEffect, useRef, useState } from 'react';
import { videoSrc, type WcrVideo } from '../lib/api';
import { LEAD_MS } from '../lib/wcr';
import { mmss } from '../lib/format';

interface Props {
  video: WcrVideo;
  /** pedido de seek: `n` muda a cada clique, mesmo repetindo o mesmo `t` */
  seek: { t: number; n: number } | null;
  onClose: () => void;
}

/** Player do vídeo do Warcraft Recorder; o tempo do vídeo = tempo do pull. */
export function VideoPanel({ video, seek, onClose }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    videoSrc(video.videoPath).then(setSrc);
  }, [video.videoPath]);

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
        <span>
          🎥 POV de <strong>{video.player ?? '?'}</strong>
          {seek && <span className="muted"> · indo para {mmss(Math.max(0, seek.t - LEAD_MS))} (5s antes)</span>}
        </span>
        <button className="btn icon" onClick={onClose} title="Fechar vídeo">
          ✕
        </button>
      </header>
      {error ? (
        <p className="muted small">
          Não foi possível tocar o vídeo aqui (codec não suportado?). Arquivo: <code>{video.videoPath}</code>
        </p>
      ) : (
        src && <video ref={ref} src={src} controls preload="metadata" onError={() => setError(true)} />
      )}
    </section>
  );
}

/** Botão ▶ que pula o vídeo para `t`; some quando o pull não tem vídeo. */
export function PlayAt({ t, seek, label }: { t: number; seek: ((t: number) => void) | null; label?: string }) {
  if (!seek) return null;
  return (
    <button
      className="play"
      title={`Ver no vídeo (${mmss(Math.max(0, t - LEAD_MS))})`}
      onClick={(e) => {
        e.stopPropagation();
        seek(t);
      }}
    >
      ▶{label ? ` ${label}` : ''}
    </button>
  );
}
