import { useState } from 'react';
import { Globe } from 'lucide-react';
import { WCL_SOURCE, inTauri, parseWclCode } from '../lib/api';
import { useSetup } from '../lib/setup';
import { useMessages } from '../i18n';
import { wclOpenMsg } from './WclOpen.i18n';

/** Abre a análise de um report do Warcraft Logs, sem o log no PC. */
export function WclOpen({ busy, onAnalyze }: { busy: boolean; onAnalyze: (path: string) => void }) {
  const setup = useSetup();
  const t = useMessages(wclOpenMsg);
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
          <strong>{t.title}</strong>
          <p className="muted small">{t.text}</p>
        </div>
      </div>
      {!inTauri ? (
        <p className="muted small">{t.appOnly}</p>
      ) : !configured ? (
        <p className="small">
          {t.connectFirst}{' '}
          <button className="link" onClick={() => setup.openSettings('wcl')}>
            {t.connect}
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
            aria-label={t.linkAria}
            spellCheck={false}
          />
          <button className="btn sm" type="submit" disabled={busy || !code}>
            {t.analyze}
          </button>
          {input.trim() !== '' && !code && <span className="small bad">{t.invalid}</span>}
        </form>
      )}
    </section>
  );
}
