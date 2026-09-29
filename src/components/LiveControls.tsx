import { useEffect, useState } from 'react';
import { MessageSquare, Radio, Send, Square } from 'lucide-react';
import { discordGetConfig, discordPost, discordSetConfig, type DiscordConfig, type LiveStatus } from '../lib/api';
import { Popover } from './Popover';

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

const STATE_LABEL: Record<LiveStatus['state'], string> = {
  watching: 'aguardando pull',
  in_combat: 'em combate',
  analyzing: 'analisando…',
  error: 'erro',
  stopped: 'parado',
};

// ---------------------------------------------------------------------------
// Ao vivo

export function LiveButton({ status, error, onStart, onStop }: { status: LiveStatus; error: string | null; onStart: () => void; onStop: () => void }) {
  const [open, setOpen] = useState(false);

  if (!status.active) {
    return (
      <div className="live-off">
        <button className="btn ghost" onClick={onStart} title="Acompanha o log enquanto vocês jogam e analisa cada pull assim que ele termina">
          <Radio {...ICON} /> Ao vivo
        </button>
        {error && (
          <span className="small bad live-error" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  const label = status.state === 'in_combat' && status.encounter ? `em combate: ${status.encounter}` : STATE_LABEL[status.state];
  const fileName = status.file?.split(/[\\/]/).pop();
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Modo ao vivo"
      trigger={
        <button className={`btn ghost live-on ${status.state} ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="live-dot" aria-hidden />
          Ao vivo <span className="small muted live-state">{label}</span>
        </button>
      }
    >
      <h4>Modo ao vivo</h4>
      <p className="muted small">
        Acompanhando <code>{fileName}</code>. Quando um pull termina, o log é reanalisado e o pull abre sozinho (e vai para o Discord, se
        configurado).
      </p>
      <p className="small">
        {status.analyzed} pull{status.analyzed === 1 ? '' : 's'} analisado{status.analyzed === 1 ? '' : 's'} nesta sessão
      </p>
      {status.message && <p className="small bad">{status.message}</p>}
      <div className="popover-footer">
        <span className="topbar-spacer" />
        <button
          className="btn sm"
          onClick={() => {
            setOpen(false);
            onStop();
          }}
        >
          <Square size={12} strokeWidth={2} aria-hidden /> Parar
        </button>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Discord

export function DiscordButton() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<DiscordConfig | null>(null);

  const reload = () => discordGetConfig().then(setConfig).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} title="Enviar o resumo de cada pull para um canal do Discord">
        <MessageSquare {...ICON} /> Discord
        <span className={`status-dot ${config?.webhook ? 'on' : ''}`} aria-label={config?.webhook ? 'configurado' : 'não configurado'} />
      </button>
      {open && config && (
        <DiscordDialog
          config={config}
          onClose={() => setOpen(false)}
          onSaved={(c) => {
            setConfig(c);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DiscordDialog({ config, onClose, onSaved }: { config: DiscordConfig; onClose: () => void; onSaved: (c: DiscordConfig) => void }) {
  const [webhook, setWebhook] = useState(config.webhook ?? '');
  const [onWipe, setOnWipe] = useState(config.onWipe);
  const [onKill, setOnKill] = useState(config.onKill);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    const c = { webhook: webhook.trim() || null, onWipe, onKill };
    try {
      await discordSetConfig(c);
      onSaved(c);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Discord" onClick={(e) => e.stopPropagation()}>
        <h3>Resumo no Discord</h3>
        <p className="small muted">
          No Discord: configurações do canal → Integrações → Webhooks → Novo webhook → Copiar URL. Com o modo ao vivo ligado, cada pull
          chega no canal com o gatilho do wipe, os erros de mecânica e quem morreu sem defensivo. Os botões "Discord" no pull e no
          resumo do boss enviam na hora.
        </p>
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
          <label>
            <input type="checkbox" checked={onWipe} onChange={(e) => setOnWipe(e.target.checked)} /> Enviar cada wipe (ao vivo)
          </label>
          <label>
            <input type="checkbox" checked={onKill} onChange={(e) => setOnKill(e.target.checked)} /> Enviar kills (ao vivo)
          </label>
        </div>
        {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={test} disabled={!webhook.trim() || sending}>
            <Send size={14} strokeWidth={1.5} aria-hidden /> Testar
          </button>
          <span className="topbar-spacer" />
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
