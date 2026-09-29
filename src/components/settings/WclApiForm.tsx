import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternal } from '../../lib/api';
import { wclSetConfig, type WclConfig } from '../../lib/wclApi';

const CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients/';

/** Client da API v2 do Warcraft Logs (grátis): habilita os tops da spec na aba Desempenho. */
export function WclApiForm({ current, onSaved }: { current: WclConfig | null; onSaved: () => void }) {
  const clientId = current?.clientId ?? null;
  const [id, setId] = useState(clientId ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await wclSetConfig(id, secret);
      setSecret('');
      setMsg({ ok: true, text: 'Conectado ao Warcraft Logs.' });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ol className="small set-steps">
        <li>
          Entre em{' '}
          <button type="button" className="link" onClick={() => openExternal(CLIENTS_URL)}>
            warcraftlogs.com/api/clients <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>{' '}
          e clique em <em>Create Client</em>.
        </li>
        <li>
          Qualquer nome; em <em>Redirect URL</em> use <code>http://localhost</code>. Deixe <em>Public Client</em> desmarcado.
        </li>
        <li>Copie o client ID e o client secret para cá.</li>
      </ol>
      <div className="field-row">
        <label className="field">
          Client ID
          <input className="text-input" value={id} spellCheck={false} autoComplete="off" onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="field">
          Client secret
          <input
            className="text-input"
            type="password"
            value={secret}
            spellCheck={false}
            autoComplete="off"
            placeholder={clientId ? '•••••••• (cole de novo para trocar)' : ''}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn primary" onClick={save} disabled={busy || !id.trim() || !secret.trim()}>
          {busy ? 'Conferindo…' : 'Salvar e conectar'}
        </button>
      </div>
      <p className="muted small">
        O secret fica no cofre de credenciais do Windows e as consultas só enviam boss, spec e código de report: nada do seu log sai do PC. O link do
        report de cada noite fica no botão <em>Warcraft Logs</em> do topo.
      </p>
    </>
  );
}
