import { useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
import { discordPost, inTauri } from '../lib/api';

/** Botão "Discord": envia a mensagem na hora para o webhook configurado no topo. */
export function SendToDiscord({ payload, label = 'Discord' }: { payload: () => unknown; label?: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  if (!inTauri) return null;

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
      title={state.kind === 'error' ? state.message : 'Enviar este resumo para o canal do Discord configurado no topo'}
    >
      {state.kind === 'sent' ? <Check size={14} strokeWidth={2} aria-hidden /> : <MessageSquare size={14} strokeWidth={1.5} aria-hidden />}
      {state.kind === 'sending' ? 'Enviando…' : state.kind === 'sent' ? 'Enviado' : state.kind === 'error' ? 'Falhou — tentar de novo' : label}
    </button>
  );
}
