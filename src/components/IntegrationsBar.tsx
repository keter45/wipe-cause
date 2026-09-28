import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import {
  inTauri,
  migrateWcrDir,
  pickFolder,
  savedWclLink,
  saveWclLink,
  wcrDetectDir,
  wcrGetDir,
  wcrSetDir,
  wcrVideos,
  type WcrScan,
  type WcrVideo,
} from '../lib/api';
import { reportCode } from '../lib/wcl';
import { matchVideos } from '../lib/wcr';

interface Props {
  logFile: string;
  pulls: Pull[];
  /** código do report do Warcraft Logs desta noite (null = sem link) */
  onWcl: (code: string | null) => void;
  onVideos: (videos: Map<number, WcrVideo>) => void;
}

/** Warcraft Logs (link do report da noite) + Warcraft Recorder (vídeos locais). */
export function IntegrationsBar({ logFile, pulls, onWcl, onVideos }: Props) {
  const [input, setInput] = useState(() => savedWclLink(logFile));
  const [scan, setScan] = useState<WcrScan | null>(null);
  const [videoCount, setVideoCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const code = reportCode(input);

  function changeLink(value: string) {
    setInput(value);
    saveWclLink(logFile, value);
    onWcl(reportCode(value));
  }

  async function loadVideos() {
    const s = await wcrVideos();
    setScan(s);
    const m = matchVideos(pulls, s.videos);
    setVideoCount(m.size);
    onVideos(m);
  }

  // ao abrir outro log: recupera o link salvo e procura os vídeos
  useEffect(() => {
    const saved = savedWclLink(logFile);
    setInput(saved);
    onWcl(reportCode(saved));
    if (inTauri) migrateWcrDir().then(loadVideos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFile]);

  return (
    <div className="wcl-bar">
      <span className="wcl-label">Warcraft Logs</span>
      <input
        className="wcl-input"
        placeholder="Cole o link do report desta noite (https://www.warcraftlogs.com/reports/…)"
        value={input}
        onChange={(e) => changeLink(e.target.value)}
      />
      {input && (
        <span className={`small wcl-status ${code ? 'muted' : 'bad'}`}>{code ? `report ${code}` : 'link inválido'}</span>
      )}
      {inTauri && (
        <span className="video-status">
          {scan?.dir && !scan.warning ? (
            <button className="btn link-btn" title={scan.dir} onClick={() => setShowSettings(true)}>
              🎥 {videoCount}/{pulls.length} pulls com vídeo
            </button>
          ) : (
            <button className="btn" onClick={() => setShowSettings(true)} title={scan?.warning ?? undefined}>
              🎥 {scan?.warning ? 'Pasta de vídeos com problema' : 'Escolher pasta de vídeos'}
            </button>
          )}
        </span>
      )}
      {showSettings && <VideoFolderDialog scan={scan} onClose={() => setShowSettings(false)} onChanged={loadVideos} />}
    </div>
  );
}

/** Cadastro da pasta onde o Warcraft Recorder salva os vídeos (varia de PC para PC). */
function VideoFolderDialog({ scan, onClose, onChanged }: { scan: WcrScan | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    wcrGetDir().then((d) => {
      setSaved(d);
      setPath(d ?? '');
    });
    wcrDetectDir().then(setDetected);
  }, []);

  async function save(dir: string | null) {
    await wcrSetDir(dir);
    setSaved(dir && dir.trim() ? dir.trim() : null);
    await onChanged();
  }

  async function browse() {
    const dir = await pickFolder('Pasta de vídeos do Warcraft Recorder');
    if (dir) {
      setPath(dir);
      await save(dir);
    }
  }

  const using = saved ? 'cadastrada aqui' : scan?.source === 'recorder' ? 'detectada no Warcraft Recorder' : null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Pasta de vídeos do Warcraft Recorder" onClick={(e) => e.stopPropagation()}>
        <h3>Pasta de vídeos do Warcraft Recorder</h3>
        <p className="small muted">
          Onde o Warcraft Recorder salva os vídeos neste PC (em Settings → General → Storage Path dentro do Recorder). O app lê os
          .mp4 e os .json dessa pasta e casa cada vídeo com o pull.
        </p>

        <label className="field">
          Caminho da pasta
          <input
            value={path}
            placeholder={detected ?? 'D:\\WarcraftRecorder'}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save(path)}
          />
        </label>
        <div className="dialog-actions left">
          <button className="btn" onClick={browse}>
            Procurar…
          </button>
          <button className="btn primary" onClick={() => save(path)} disabled={!path.trim() || path.trim() === saved}>
            Salvar
          </button>
          {detected && (
            <button
              className="btn"
              onClick={() => {
                setPath('');
                save(null);
              }}
              disabled={!saved}
              title={detected}
            >
              Usar a do Warcraft Recorder
            </button>
          )}
        </div>

        <div className="folder-status small">
          {scan?.dir ? (
            <>
              <div>
                Usando <code>{scan.dir}</code> {using && <span className="muted">({using})</span>}
              </div>
              {scan.warning ? <div className="bad">⚠ {scan.warning}</div> : <div className="ok-text">✓ {scan.videos.length} vídeos de encontros encontrados</div>}
            </>
          ) : (
            <div className="muted">
              Nenhuma pasta cadastrada{detected ? '' : ' e o Warcraft Recorder não foi encontrado neste PC'}.
            </div>
          )}
          {detected && !saved && scan?.source !== 'recorder' && <div className="muted">Detectada no Recorder: {detected}</div>}
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
