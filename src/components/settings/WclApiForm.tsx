import { useState } from 'react';
import { ExternalLink, LogIn, LogOut } from 'lucide-react';
import { openExternal } from '../../lib/api';
import { wclLogin, wclLogout, wclSetConfig, type WclConfig } from '../../lib/wclApi';

const CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients/';

/**
 * Warcraft Logs: entrar com a conta (vê os reports das suas guildas, inclusive não listados)
 * ou, avançado, um client próprio da API v2 (só reports públicos).
 */
export function WclApiForm({ current, onSaved }: { current: WclConfig | null; onSaved: () => void }) {
  const user = current?.user ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function login() {
    setBusy(true);
    setMsg({ ok: true, text: 'Continue no navegador: autorize o Wipe Cause no Warcraft Logs e volte para cá.' });
    try {
      const u = await wclLogin();
      setMsg({ ok: true, text: `Conectado como ${u.name}.` });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await wclLogout();
    setMsg(null);
    onSaved();
  }

  return (
    <>
      {current?.loginAvailable && (
        <div className="wcl-account">
          {user ? (
            <>
              <p className="small">
                Conectado como <strong>{user.name}</strong>
                {user.guilds.length > 0 && (
                  <span className="muted">
                    {' '}
                    · {user.guilds.map((g) => `${g.name} (${g.serverName}-${g.region})`).join(', ')}
                  </span>
                )}
              </p>
              <div className="set-actions">
                <button className="btn ghost sm" onClick={logout}>
                  <LogOut size={14} strokeWidth={1.5} aria-hidden /> Sair
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small">
                Entre com a sua conta: o app passa a ver os reports das suas guildas (inclusive os não listados), sem precisar do log no PC.
              </p>
              <div className="set-actions">
                <button className="btn primary" onClick={login} disabled={busy}>
                  <LogIn size={14} strokeWidth={1.5} aria-hidden /> {busy ? 'Esperando o navegador…' : 'Entrar com o Warcraft Logs'}
                </button>
              </div>
            </>
          )}
          {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
        </div>
      )}
      {current?.loginAvailable ? (
        <details className="wcl-advanced">
          <summary className="small">Avançado: usar um client próprio da API</summary>
          <ClientForm current={current} onSaved={onSaved} />
        </details>
      ) : (
        <ClientForm current={current} onSaved={onSaved} />
      )}
    </>
  );
}

/** Client da API v2 do Warcraft Logs (grátis): consultas sem login, só com reports públicos. */
function ClientForm({ current, onSaved }: { current: WclConfig | null; onSaved: () => void }) {
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
        Sem login, a API só mostra reports públicos. O secret fica no cofre de credenciais do Windows e as consultas só enviam boss, spec e código de
        report: nada do seu log sai do PC.
      </p>
    </>
  );
}
