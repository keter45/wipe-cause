import { useState } from 'react';
import { Globe } from 'lucide-react';
import { WCL_SOURCE, inTauri, parseWclCode } from '../lib/api';
import { useSetup } from '../lib/setup';

/** Abre a análise de um report do Warcraft Logs, sem o log no PC. */
export function WclOpen({ busy, onAnalyze }: { busy: boolean; onAnalyze: (path: string) => void }) {
  const setup = useSetup();
  const [input, setInput] = useState('');
  const code = parseWclCode(input);
  const configured = !!setup.status?.wcl?.configured;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code) onAnalyze(WCL_SOURCE + code);
  }

  return (
    <section className="wcl-open">
      <div className="wcl-open-head">
        <Globe size={16} strokeWidth={1.5} aria-hidden />
        <div>
          <strong>Report de fora da lista?</strong>
          <p className="muted small">Cole o link de qualquer report do Warcraft Logs (de outra guilda, por exemplo). O que estiver num log do seu PC sai dele.</p>
        </div>
      </div>
      {!inTauri ? (
        <p className="muted small">Disponível no app instalado.</p>
      ) : !configured ? (
        <p className="small">
          Conecte o Warcraft Logs para abrir reports de lá.{' '}
          <button className="link" onClick={() => setup.openSettings('wcl')}>
            Conectar
          </button>
        </p>
      ) : (
        <form className="wcl-open-form" onSubmit={submit}>
          <input
            className="text-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://www.warcraftlogs.com/reports/…"
            aria-label="Link do report do Warcraft Logs"
            spellCheck={false}
          />
          <button className="btn sm" type="submit" disabled={busy || !code}>
            Analisar
          </button>
          {input.trim() !== '' && !code && <span className="small bad">Link ou código de report inválido.</span>}
        </form>
      )}
    </section>
  );
}
