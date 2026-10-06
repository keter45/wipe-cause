import { useState } from 'react';
import { ExternalLink, LogIn, LogOut } from 'lucide-react';
import { openExternal } from '../../lib/api';
import { autoLiveEnabled, setAutoLiveEnabled } from '../../lib/autoLive';
import { wclLogin, wclLogout, wclSetConfig, type WclConfig } from '../../lib/wclApi';
import { useMessages } from '../../i18n';
import { wclApiMsg } from './WclApiForm.i18n';

const CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients/';

/**
 * Warcraft Logs: entrar com a conta (vê os reports das suas guildas, inclusive não listados)
 * ou, avançado, um client próprio da API v2 (só reports públicos).
 */
export function WclApiForm({ current, onSaved }: { current: WclConfig | null; onSaved: () => void }) {
  const t = useMessages(wclApiMsg);
  const user = current?.user ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function login() {
    setBusy(true);
    setMsg({ ok: true, text: t.continueInBrowser });
    try {
      const u = await wclLogin();
      setMsg({ ok: true, text: t.connectedAs(u.name) });
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
                {t.connectedLabel} <strong>{user.name}</strong>
                {user.guilds.length > 0 && (
                  <span className="muted">
                    {' '}
                    · {user.guilds.map((g) => `${g.name} (${g.serverName}-${g.region})`).join(', ')}
                  </span>
                )}
              </p>
              <AutoLiveSwitch />
              <div className="set-actions">
                <button className="btn ghost sm" onClick={logout}>
                  <LogOut size={14} strokeWidth={1.5} aria-hidden /> {t.signOut}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small">{t.signInText}</p>
              <div className="set-actions">
                <button className="btn primary" onClick={login} disabled={busy}>
                  <LogIn size={14} strokeWidth={1.5} aria-hidden /> {busy ? t.waiting : t.signIn}
                </button>
              </div>
            </>
          )}
          {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
        </div>
      )}
      {current?.loginAvailable ? (
        <details className="wcl-advanced">
          <summary className="small">{t.advanced}</summary>
          <ClientForm current={current} onSaved={onSaved} />
        </details>
      ) : (
        <ClientForm current={current} onSaved={onSaved} />
      )}
    </>
  );
}

/** Ligar o ao vivo sozinho quando a guilda começar a subir log ao vivo. */
function AutoLiveSwitch() {
  const t = useMessages(wclApiMsg);
  const [on, setOn] = useState(autoLiveEnabled);
  return (
    <label className="auto-live small">
      <span className="switch">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setAutoLiveEnabled(e.target.checked);
          }}
        />
        <span aria-hidden />
      </span>
      {t.autoLive}
    </label>
  );
}

/** Client da API v2 do Warcraft Logs (grátis): consultas sem login, só com reports públicos. */
function ClientForm({ current, onSaved }: { current: WclConfig | null; onSaved: () => void }) {
  const t = useMessages(wclApiMsg);
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
      setMsg({ ok: true, text: t.connected });
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
          {t.step1(
            <button type="button" className="link" onClick={() => openExternal(CLIENTS_URL)}>
              warcraftlogs.com/api/clients <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </button>,
          )}
        </li>
        <li>{t.step2()}</li>
        <li>{t.step3}</li>
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
            placeholder={clientId ? t.secretSaved : ''}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn primary" onClick={save} disabled={busy || !id.trim() || !secret.trim()}>
          {busy ? t.checking : t.saveConnect}
        </button>
      </div>
      <p className="muted small">{t.privacy}</p>
    </>
  );
}
