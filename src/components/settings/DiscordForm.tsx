import { useState } from 'react';
import { Send } from 'lucide-react';
import { discordPost, discordSetConfig, type DiscordConfig } from '../../lib/api';

/** Webhook do canal da raid: resumo de cada pull no modo ao vivo e botões "Discord" na hora. */
export function DiscordForm({ current, onSaved }: { current: DiscordConfig | null; onSaved: () => void }) {
  const [webhook, setWebhook] = useState(current?.webhook ?? '');
  const [onWipe, setOnWipe] = useState(current?.onWipe ?? true);
  const [onKill, setOnKill] = useState(current?.onKill ?? true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  async function test() {
    setSending(true);
    setMsg(null);
    try {
      await discordPost({ username: 'Wipe Cause', content: 'Wipe Cause conectado: os resumos dos pulls vão chegar neste canal.' }, webhook.trim());
      setMsg({ ok: true, text: 'Mensagem de teste enviada. Confira o canal.' });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSending(false);
    }
  }

  async function save() {
    try {
      await discordSetConfig({ webhook: webhook.trim() || null, onWipe, onKill });
      setMsg({ ok: true, text: webhook.trim() ? 'Salvo.' : 'Discord desligado.' });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  const dirty = (webhook.trim() || null) !== (current?.webhook ?? null) || onWipe !== (current?.onWipe ?? true) || onKill !== (current?.onKill ?? true);
  return (
    <>
      <ol className="small set-steps">
        <li>No Discord, abra as configurações do canal → Integrações → Webhooks.</li>
        <li>
          <em>Novo webhook</em> → <em>Copiar URL do webhook</em> e cole abaixo.
        </li>
      </ol>
      <label className="field">
        URL do webhook
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
        <span className="small muted">Com o modo ao vivo ligado, enviar sozinho:</span>
        <label>
          <input type="checkbox" checked={onWipe} onChange={(e) => setOnWipe(e.target.checked)} /> cada wipe
        </label>
        <label>
          <input type="checkbox" checked={onKill} onChange={(e) => setOnKill(e.target.checked)} /> cada kill
        </label>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn" onClick={test} disabled={!webhook.trim() || sending}>
          <Send size={14} strokeWidth={1.5} aria-hidden /> Enviar teste
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty}>
          Salvar
        </button>
      </div>
      <p className="muted small">A mensagem traz o gatilho do wipe, os erros de mecânica e quem morreu sem defensivo.</p>
    </>
  );
}
