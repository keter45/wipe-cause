import type { ReactNode } from 'react';
import { Hint } from './Hint';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** variação ao lado do valor (ex.: +12%) */
  delta?: string;
  /** contexto embaixo (referência, horário...) */
  sub?: ReactNode;
  /** segunda linha de contexto */
  extra?: ReactNode;
  /** cor do que o número significa; neutro = só contexto */
  tone?: Tone;
  /** explicação do número (ícone ao lado do rótulo) */
  hint?: ReactNode;
  title?: string;
  onClick?: () => void;
}

/** Número em destaque: o mesmo cartão em todas as telas (noite, boss, você, comparação, morte). */
export function Stat({ label, value, delta, sub, extra, tone = 'neutral', hint, title, onClick }: StatProps) {
  const body = (
    <>
      <span className="kpi-label">
        {tone !== 'neutral' && <span className="kpi-dot" aria-hidden />}
        {label}
        {hint && <Hint>{hint}</Hint>}
      </span>
      <strong className="kpi-value tabular">
        {value}
        {delta && <span className="kpi-delta">{delta}</span>}
      </strong>
      {sub && <span className="muted small tabular">{sub}</span>}
      {extra && <span className="muted small tabular">{extra}</span>}
    </>
  );
  const cls = `kpi tone-${tone} ${onClick ? 'clickable' : ''}`;
  return onClick ? (
    <button type="button" className={cls} title={title} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

/** Grade de cartões de número; `compact` para dentro de outro cartão (detalhe da morte). */
export function StatGrid({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`kpis ${compact ? 'compact' : ''}`}>{children}</div>;
}
