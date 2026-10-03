import { useState } from 'react';
import { Send } from 'lucide-react';
import { discordPost, discordSetConfig, type DiscordConfig } from '../../lib/api';

/** Webhook do canal da raid: no modo ao vivo, imagens de cada pull e da noite; no Compartilhar, na hora. */
export function DiscordForm({ current, onSaved }: { current: DiscordConfig | null; onSaved: () => void }) {
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
      await discordSetConfig({ webhook: webhook.trim() || null, onWipe, onKill, onNight, auto: current?.auto ?? true });
      setMsg({ ok: true, text: webhook.trim() ? 'Salvo.' : 'Discord desligado.' });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  const dirty = (webhook.trim() || null) !== (current?.webhook ?? null) || onWipe !== (current?.onWipe ?? true) || onKill !== (current?.onKill ?? true) || onNight !== (current?.onNight ?? true);
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
          <input type="checkbox" checked={onWipe} onChange={(e) => setOnWipe(e.target.checked)} /> cada wipe (o motivo do wipe)
        </label>
        <label>
          <input type="checkbox" checked={onKill} onChange={(e) => setOnKill(e.target.checked)} /> cada kill (o resumo do boss)
        </label>
        <label>
          <input type="checkbox" checked={onNight} onChange={(e) => setOnNight(e.target.checked)} /> o resumo da noite, no fim da raid
        </label>
      </div>
      {current?.webhook && current.auto === false && <p className="small warn">O envio automático está pausado pelo botão Discord no topo do app.</p>}
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn" onClick={test} disabled={!webhook.trim() || sending}>
          <Send size={14} strokeWidth={1.5} aria-hidden /> Enviar teste
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty}>
          Salvar
        </button>
      </div>
      <p className="muted small">
        Tudo vai como imagem, o mesmo cartão do <em>Compartilhar</em>. O fim da raid é quando você desliga o ao vivo ou depois de 30 min sem pull novo.
      </p>
    </>
  );
}
