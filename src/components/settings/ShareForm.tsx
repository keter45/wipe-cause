import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { openExternal, shareGithubGet, shareGithubSet, shareNewLink, shareStart, shareStatus, shareStop, type GithubStatus, type ShareStatus } from '../../lib/api';
import { useMessages } from '../../i18n';
import { shareFormMsg } from './ShareForm.i18n';

/** Página do GitHub que cria o token já com a permissão `gist` marcada. */
const NEW_TOKEN = 'https://github.com/settings/tokens/new?scopes=gist&description=Wipe%20Cause';

/** Liga e desliga o link de visualização, mostra o link para copiar e conecta o GitHub (link fixo). */
export function ShareForm({ onChange }: { onChange: (s: ShareStatus) => void }) {
  const t = useMessages(shareFormMsg);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState<'start' | 'new' | 'github' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

  const show = (s: ShareStatus) => {
    setStatus(s);
    onChange(s);
  };
  useEffect(() => {
    shareStatus().then(show).catch(() => {});
    shareGithubGet().then(setGithub).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(kind: 'start' | 'new' | 'github', fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const change = (next: boolean) =>
    run('start', async () => {
      if (next) show(await shareStart());
      else {
        await shareStop();
        show(await shareStatus());
      }
    });
  const newLink = () => run('new', async () => show(await shareNewLink()));
  const connect = (value: string | null) =>
    run('github', async () => {
      setGithub(await shareGithubSet(value));
      setToken('');
      show(await shareStatus());
    });

  const link = status?.fixedUrl ?? status?.url ?? null;
  return (
    <>
      <label className="auto-live small">
        <span className="switch">
          <input type="checkbox" checked={!!status?.active || busy === 'start'} disabled={busy != null} onChange={(e) => change(e.target.checked)} />
          <span aria-hidden />
        </span>
        {t.label}
      </label>
      <p className="muted small">{t.text}</p>
      {busy === 'start' && <p className="muted small">{t.starting}</p>}

      {status?.active && (link || status.localUrl) && (
        <div className="share-link">
          <span className="small">{status.fixedUrl ? t.fixedLink : link ? t.link : t.localOnly}</span>
          <LinkRow url={link ?? status.localUrl!} />
          {!status.fixedUrl && link && <p className="muted small">{t.notFixed}</p>}
          <p className="muted small">{t.privacy}</p>
        </div>
      )}

      <div className="share-github">
        <h4 className="small">{t.githubTitle}</h4>
        {github?.connected ? (
          <div className="set-actions left">
            <span className="small ok-text">{t.githubConnected(github.user ?? '?')}</span>
            <button className="btn ghost sm" disabled={busy != null} onClick={() => connect(null)}>
              {t.disconnect}
            </button>
          </div>
        ) : (
          <>
            <p className="muted small">{t.githubText}</p>
            <div className="share-link-row">
              <input
                className="text-input mono"
                type="password"
                autoComplete="off"
                placeholder="ghp_…"
                aria-label={t.tokenAria}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn sm" disabled={busy != null || !token.trim()} onClick={() => connect(token)}>
                {busy === 'github' ? t.connecting : t.connect}
              </button>
            </div>
            <button className="link small" onClick={() => openExternal(NEW_TOKEN)}>
              {t.createToken} <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </>
        )}
      </div>

      <div className="set-actions left">
        <button className="btn ghost sm" disabled={busy != null} onClick={newLink} title={t.newLinkTitle}>
          <RefreshCw size={14} strokeWidth={1.5} className={busy === 'new' ? 'spin' : ''} aria-hidden /> {t.newLink}
        </button>
      </div>
      {(error ?? status?.error) && <p className="small bad">{error ?? status?.error}</p>}
    </>
  );
}

function LinkRow({ url }: { url: string }) {
  const t = useMessages(shareFormMsg);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem área de transferência: o campo já fica selecionável */
    }
  }
  return (
    <div className="share-link-row">
      <input className="text-input mono" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t.link} />
      <button className="btn sm" onClick={copy}>
        {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.5} aria-hidden />} {copied ? t.copied : t.copy}
      </button>
      <button className="btn ghost sm" onClick={() => openExternal(url)}>
        {t.open} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
