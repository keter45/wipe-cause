import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { openExternal, shareStart, shareStatus, shareStop, type ShareStatus } from '../../lib/api';
import { useMessages } from '../../i18n';
import { shareFormMsg } from './ShareForm.i18n';

/** Liga e desliga o link de visualização e mostra o link para copiar. */
export function ShareForm({ onChange }: { onChange: (s: ShareStatus) => void }) {
  const t = useMessages(shareFormMsg);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const show = (s: ShareStatus) => {
    setStatus(s);
    onChange(s);
  };
  useEffect(() => {
    shareStatus().then(show).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (next) show(await shareStart());
      else {
        await shareStop();
        show(await shareStatus());
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }

  const url = status?.url ?? null;
  const shown = url ?? status?.localUrl ?? null;
  return (
    <>
      <label className="auto-live small">
        <span className="switch">
          <input type="checkbox" checked={!!status?.active || busy} disabled={busy} onChange={(e) => change(e.target.checked)} />
          <span aria-hidden />
        </span>
        {t.label}
      </label>
      <p className="muted small">{t.text}</p>
      {busy && <p className="muted small">{t.starting}</p>}
      {status?.active && shown && (
        <div className="share-link">
          <span className="small">{url ? t.link : t.localOnly}</span>
          <div className="share-link-row">
            <input className="text-input mono" readOnly value={shown} onFocus={(e) => e.target.select()} aria-label={t.link} />
            <button className="btn sm" onClick={() => copy(shown)}>
              {copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.5} aria-hidden />} {copied ? t.copied : t.copy}
            </button>
            <button className="btn ghost sm" onClick={() => openExternal(shown)}>
              {t.open} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <p className="muted small">{t.privacy}</p>
        </div>
      )}
      {(error ?? status?.error) && <p className="small bad">{error ?? status?.error}</p>}
    </>
  );
}
