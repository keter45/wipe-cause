import type { ReactNode } from 'react';
import { Check, CircleDashed } from 'lucide-react';
import { missingRequired, useSetup, type SettingsSection } from '../../lib/setup';
import { useMessages } from '../../i18n';
import { firstStepsMsg } from './FirstSteps.i18n';

/**
 * Passo a passo do app: aberto na primeira vez (a tela inicial é esta) e, depois, recolhido em
 * "Como funciona". Cada passo mostra se já está pronto e leva ao cartão dele.
 */
export function FirstSteps({ firstRun, onStart, onOpen }: { firstRun: boolean; onStart: () => void; onOpen: (s: SettingsSection) => void }) {
  const { status } = useSetup();
  const t = useMessages(firstStepsMsg);
  const logsOk = status != null && !missingRequired(status);
  const wclUser = status?.wcl?.user ?? null;

  const body = (
    <>
      <ol className="steps">
        <Step done={logsOk} title={t.logsTitle} action={<button className="link" onClick={() => onOpen('logs')}>{logsOk ? t.see : t.configure}</button>}>
          {t.logsText(status?.logsDir ? <code>{status.logsDir}</code> : <code>World of Warcraft\_retail_\Logs</code>)}
        </Step>
        <Step done={null} title={t.gameTitle} action={<button className="link" onClick={() => onOpen('game')}>{t.how}</button>}>
          {t.gameText()}
        </Step>
        <Step done={wclUser != null} title={t.wclTitle} action={<button className="link" onClick={() => onOpen('wcl')}>{wclUser ? t.see : t.signIn}</button>}>
          {wclUser ? t.connectedAs(wclUser.name) : null}
          {t.wclText}
        </Step>
        <Step done={null} title={t.optionalTitle} action={<button className="link" onClick={() => onOpen('startup')}>{t.seeOptions}</button>}>
          {t.optionalText}
        </Step>
      </ol>

      <div className="how">
        <h3>{t.dailyTitle}</h3>
        <ul>{t.daily()}</ul>
      </div>
    </>
  );

  if (!firstRun) {
    return (
      <details className="first-steps panel">
        <summary>{t.howItWorks}</summary>
        {body}
      </details>
    );
  }
  return (
    <section className="first-steps panel open">
      <h2>{t.firstSteps}</h2>
      <p className="muted small">{t.intro}</p>
      {body}
      <div className="set-actions">
        <button className="btn primary" onClick={onStart} disabled={!logsOk} title={logsOk ? undefined : t.missingLogs}>
          {t.start}
        </button>
      </div>
    </section>
  );
}

function Step({ done, title, action, children }: { done: boolean | null; title: string; action: ReactNode; children: ReactNode }) {
  return (
    <li className={`step ${done ? 'done' : ''}`}>
      <span className="step-mark" aria-hidden>
        {done ? <Check size={14} strokeWidth={2.5} /> : <CircleDashed size={14} strokeWidth={1.75} />}
      </span>
      <div>
        <strong>{title}</strong> {action}
        <p className="muted small">{children}</p>
      </div>
    </li>
  );
}
