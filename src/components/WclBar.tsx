import { useEffect, useState } from 'react';
import type { Pull } from '../types';
import { inTauri, openExternal, savedWclLink, saveWclLink, wclGetSettings, wclReport, wclSaveSettings } from '../lib/api';
import { matchFights } from '../lib/wcl';

export interface WclLink {
  code: string;
  title: string;
  /** pull.id -> fight id no WCL */
  fights: Map<number, number>;
}

interface Props {
  logFile: string;
  pulls: Pull[];
  onLinked: (link: WclLink | null) => void;
}

/** Campo do link do report do Warcraft Logs + configuração da API. */
export function WclBar({ logFile, pulls, onLinked }: Props) {
  const [input, setInput] = useState(() => savedWclLink(logFile));
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  async function link(value: string) {
    saveWclLink(logFile, value);
    if (!value.trim()) {
      onLinked(null);
      setStatus('');
      return;
    }
    setBusy(true);
    setStatus('Buscando fights no Warcraft Logs…');
    try {
      const r = await wclReport(value);
      const fights = matchFights(pulls, r.fights);
      onLinked({ code: r.code, title: r.title, fights });
      setStatus(`${r.title || r.code}: ${fights.size}/${pulls.length} pulls ligados`);
    } catch (e) {
      onLinked(null);
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  // reabre o link salvo para este log
  useEffect(() => {
    const saved = savedWclLink(logFile);
    setInput(saved);
    if (saved && inTauri) link(saved);
    else onLinked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFile]);

  if (!inTauri) return null;

  return (
    <div className="wcl-bar">
      <span className="wcl-label">Warcraft Logs</span>
      <input
        className="wcl-input"
        placeholder="Cole o link do report (https://www.warcraftlogs.com/reports/…)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && link(input)}
      />
      <button className="btn" onClick={() => link(input)} disabled={busy}>
        Ligar
      </button>
      <button className="btn icon" title="Configurar API do Warcraft Logs" onClick={() => setShowSettings(true)}>
        ⚙
      </button>
      {status && <span className="muted small wcl-status">{status}</span>}
      {showSettings && <WclSettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function WclSettingsDialog({ onClose }: { onClose: () => void }) {
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

  async function save() {
    try {
      await wclSaveSettings(clientId, secret);
      setMsg('Salvo.');
      setHasSecret(hasSecret || secret.length > 0);
      setSecret('');
    } catch (e) {
      setMsg(String(e));
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="API do Warcraft Logs" onClick={(e) => e.stopPropagation()}>
        <h3>API do Warcraft Logs</h3>
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
          <button className="btn primary" onClick={save} disabled={!clientId}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
