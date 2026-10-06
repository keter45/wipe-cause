import { useState } from 'react';
import { Send } from 'lucide-react';
import { discordPost, discordSetConfig, type DiscordConfig } from '../../lib/api';
import { useMessages } from '../../i18n';
import { discordFormMsg } from './DiscordForm.i18n';

/** Webhook do canal da raid: no modo ao vivo, imagens de cada pull e da noite; no Compartilhar, na hora. */
export function DiscordForm({ current, onSaved }: { current: DiscordConfig | null; onSaved: () => void }) {
  const t = useMessages(discordFormMsg);
  const [webhook, setWebhook] = useState(current?.webhook ?? '');
  const [onWipe, setOnWipe] = useState(current?.onWipe ?? true);
  const [onKill, setOnKill] = useState(current?.onKill ?? true);
  const [onNight, setOnNight] = useState(current?.onNight ?? true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  async function test() {
    setSending(true);
    setMsg(null);
    try {
      await discordPost({ username: 'Wipe Cause', content: t.testContent }, webhook.trim());
      setMsg({ ok: true, text: t.testSent });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSending(false);
    }
  }

  async function save() {
    try {
      await discordSetConfig({ webhook: webhook.trim() || null, onWipe, onKill, onNight, auto: current?.auto ?? true });
      setMsg({ ok: true, text: webhook.trim() ? t.saved : t.off });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  const dirty = (webhook.trim() || null) !== (current?.webhook ?? null) || onWipe !== (current?.onWipe ?? true) || onKill !== (current?.onKill ?? true) || onNight !== (current?.onNight ?? true);
  return (
    <>
      <ol className="small set-steps">
        <li>{t.step1}</li>
        <li>{t.step2()}</li>
      </ol>
      <label className="field">
        {t.url}
        <input
          className="text-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={webhook}
          placeholder="https://discord.com/api/webhooks/…"
          onChange={(e) => setWebhook(e.target.value)}
        />
      </label>
      <div className="check-row">
        <span className="small muted">{t.autoSend}</span>
        <label>
          <input type="checkbox" checked={onWipe} onChange={(e) => setOnWipe(e.target.checked)} /> {t.onWipe}
        </label>
        <label>
          <input type="checkbox" checked={onKill} onChange={(e) => setOnKill(e.target.checked)} /> {t.onKill}
        </label>
        <label>
          <input type="checkbox" checked={onNight} onChange={(e) => setOnNight(e.target.checked)} /> {t.onNight}
        </label>
      </div>
      {current?.webhook && current.auto === false && <p className="small warn">{t.paused}</p>}
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn" onClick={test} disabled={!webhook.trim() || sending}>
          <Send size={14} strokeWidth={1.5} aria-hidden /> {t.sendTest}
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty}>
          {t.save}
        </button>
      </div>
      <p className="muted small">{t.footer()}</p>
    </>
  );
}
