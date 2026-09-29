import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import { discordPost, inTauri } from '../lib/api';
import { useSetup } from '../lib/setup';

/** Botão "Discord": envia a mensagem na hora para o webhook das Configurações (sem ele, leva até lá). */
export function SendToDiscord({ payload, label = 'Discord' }: { payload: () => unknown; label?: string }) {
  const { status, openSettings } = useSetup();
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  if (!inTauri) return null;
  if (status && !status.discord?.webhook) {
    return (
      <button className="btn sm ghost" onClick={() => openSettings('discord')} title="Configurar o webhook do canal da raid">
        <MessageSquare size={14} strokeWidth={1.5} aria-hidden /> {label}
      </button>
    );
  }

  async function send() {
    setState({ kind: 'sending' });
    try {
      await discordPost(payload());
      setState({ kind: 'sent' });
      window.setTimeout(() => setState({ kind: 'idle' }), 4000);
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }

  return (
    <button
      className="btn sm"
      onClick={send}
      disabled={state.kind === 'sending'}
      title={state.kind === 'error' ? state.message : 'Enviar este resumo para o canal do Discord'}
    >
      {state.kind === 'sent' ? <Check size={14} strokeWidth={2} aria-hidden /> : <MessageSquare size={14} strokeWidth={1.5} aria-hidden />}
      {state.kind === 'sending' ? 'Enviando…' : state.kind === 'sent' ? 'Enviado' : state.kind === 'error' ? 'Falhou — tentar de novo' : label}
    </button>
  );
}
