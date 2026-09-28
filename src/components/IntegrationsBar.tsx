import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { inTauri, pickFolder, savedWclLink, saveWclLink, savedWcrDir, saveWcrDir, wcrVideos, type WcrScan, type WcrVideo } from '../lib/api';
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
    const s = await wcrVideos(savedWcrDir() || null);
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
    if (inTauri) loadVideos();
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
        <>
          <span className="wcl-label video-status" title={scan?.dir ?? 'Pasta de vídeos não encontrada'}>
            🎥 {scan?.dir ? `${videoCount}/${pulls.length} pulls com vídeo` : 'sem pasta de vídeos'}
          </span>
          <button className="btn icon" title="Pasta de vídeos" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </>
      )}
      {showSettings && <VideoSettings scan={scan} onClose={() => setShowSettings(false)} onChanged={loadVideos} />}
    </div>
  );
}

function VideoSettings({ scan, onClose, onChanged }: { scan: WcrScan | null; onClose: () => void; onChanged: () => void }) {
  async function chooseDir() {
    const dir = await pickFolder('Pasta de vídeos do Warcraft Recorder');
    if (dir) {
      saveWcrDir(dir);
      onChanged();
    }
  }
  function useRecorderDir() {
    saveWcrDir('');
    onChanged();
  }
  const sourceLabel = { settings: 'escolhida aqui', recorder: 'detectada nas configurações do Warcraft Recorder', none: '' };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Vídeos do Warcraft Recorder" onClick={(e) => e.stopPropagation()}>
        <h3>Warcraft Recorder</h3>
        <p className="small">
          {scan?.dir ? (
            <>
              Vídeos em <code>{scan.dir}</code>{' '}
              <span className="muted">
                ({sourceLabel[scan.source]}, {scan.videos.length} encontros)
              </span>
            </>
          ) : (
            'Pasta de vídeos não encontrada.'
          )}
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={chooseDir}>
            Escolher pasta…
          </button>
          {scan?.source === 'settings' && (
            <button className="btn" onClick={useRecorderDir}>
              Usar a do Warcraft Recorder
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
