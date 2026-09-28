import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import {
  inTauri,
  openExternal,
  pickFolder,
  savedWclLink,
  saveWclLink,
  savedWcrDir,
  saveWcrDir,
  wclGetSettings,
  wclReport,
  wclSaveSettings,
  wcrVideos,
  type WcrScan,
  type WcrVideo,
} from '../lib/api';
import { matchFights } from '../lib/wcl';
import { matchVideos } from '../lib/wcr';

export interface WclLink {
  code: string;
  title: string;
  /** pull.id -> fight id no WCL */
  fights: Map<number, number>;
}

interface Props {
  logFile: string;
  pulls: Pull[];
  onWcl: (link: WclLink | null) => void;
  onVideos: (videos: Map<number, WcrVideo>) => void;
}

/** Warcraft Logs (link do report da noite) + Warcraft Recorder (vídeos locais). */
export function IntegrationsBar({ logFile, pulls, onWcl, onVideos }: Props) {
  const [input, setInput] = useState(() => savedWclLink(logFile));
  const [wclStatus, setWclStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<WcrScan | null>(null);
  const [videoCount, setVideoCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  async function link(value: string) {
    saveWclLink(logFile, value);
    if (!value.trim()) {
      onWcl(null);
      setWclStatus('');
      return;
    }
    setBusy(true);
    setWclStatus('Buscando fights no Warcraft Logs…');
    try {
      const r = await wclReport(value);
      const fights = matchFights(pulls, r.fights);
      onWcl({ code: r.code, title: r.title, fights });
      setWclStatus(`${r.title || r.code}: ${fights.size}/${pulls.length} pulls ligados`);
    } catch (e) {
      onWcl(null);
      setWclStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadVideos() {
    const s = await wcrVideos(savedWcrDir() || null);
    setScan(s);
    const m = matchVideos(pulls, s.videos);
    setVideoCount(m.size);
    onVideos(m);
  }

  // ao abrir outro log: religa o report salvo e procura os vídeos
  useEffect(() => {
    if (!inTauri) return;
    const saved = savedWclLink(logFile);
    setInput(saved);
    if (saved) link(saved);
    else onWcl(null);
    loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFile]);

  if (!inTauri) return null;

  return (
    <div className="wcl-bar">
      <span className="wcl-label">Warcraft Logs</span>
      <input
        className="wcl-input"
        placeholder="Link do report desta noite (https://www.warcraftlogs.com/reports/…)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && link(input)}
      />
      <button className="btn" onClick={() => link(input)} disabled={busy}>
        Ligar
      </button>
      {wclStatus && <span className="muted small wcl-status">{wclStatus}</span>}
      <span className="wcl-label video-status" title={scan?.dir ?? 'Pasta de vídeos não encontrada'}>
        🎥 {scan?.dir ? `${videoCount}/${pulls.length} pulls com vídeo` : 'sem pasta de vídeos'}
      </span>
      <button className="btn icon" title="Configurações" onClick={() => setShowSettings(true)}>
        ⚙
      </button>
      {showSettings && (
        <SettingsDialog
          scan={scan}
          onClose={() => setShowSettings(false)}
          onVideoDirChanged={loadVideos}
        />
      )}
    </div>
  );
}

function SettingsDialog({ scan, onClose, onVideoDirChanged }: { scan: WcrScan | null; onClose: () => void; onVideoDirChanged: () => void }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    wclGetSettings().then((s) => {
      setClientId(s.clientId);
      setHasSecret(s.hasSecret);
    });
  }, []);

  async function saveWcl() {
    try {
      await wclSaveSettings(clientId, secret);
      setMsg('Salvo.');
      setHasSecret(hasSecret || secret.length > 0);
      setSecret('');
    } catch (e) {
      setMsg(String(e));
    }
  }

  async function chooseDir() {
    const dir = await pickFolder('Pasta de vídeos do Warcraft Recorder');
    if (dir) {
      saveWcrDir(dir);
      onVideoDirChanged();
    }
  }

  function useRecorderDir() {
    saveWcrDir('');
    onVideoDirChanged();
  }

  const sourceLabel = { settings: 'escolhida aqui', recorder: 'detectada nas configurações do Warcraft Recorder', none: '' };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Configurações" onClick={(e) => e.stopPropagation()}>
        <h3>Warcraft Recorder</h3>
        <p className="small">
          {scan?.dir ? (
            <>
              Vídeos em <code>{scan.dir}</code> <span className="muted">({sourceLabel[scan.source]}, {scan.videos.length} encontros)</span>
            </>
          ) : (
            'Pasta de vídeos não encontrada.'
          )}
        </p>
        <div className="dialog-actions left">
          <button className="btn" onClick={chooseDir}>
            Escolher pasta…
          </button>
          {scan?.source === 'settings' && (
            <button className="btn" onClick={useRecorderDir}>
              Usar a do Warcraft Recorder
            </button>
          )}
        </div>

        <h3 className="dialog-section">API do Warcraft Logs</h3>
        <p className="small">
          Usada só para descobrir o número de cada fight no report e abrir a try certa. Crie um client (gratuito) em{' '}
          <button className="link" onClick={() => openExternal('https://www.warcraftlogs.com/api/clients/')}>
            warcraftlogs.com/api/clients
          </button>{' '}
          — qualquer nome, redirect URL pode ser <code>http://localhost</code> — e cole o client id e o secret aqui.
        </p>
        <label className="field">
          Client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          Client secret
          <input
            type="password"
            value={secret}
            placeholder={hasSecret ? '(salvo — deixe vazio para manter)' : ''}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p className="muted small">Fica salvo só nesta máquina, na pasta de configuração do app.</p>
        <div className="dialog-actions">
          {msg && <span className="muted small">{msg}</span>}
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
          <button className="btn primary" onClick={saveWcl} disabled={!clientId}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
