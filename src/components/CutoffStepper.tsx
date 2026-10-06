import { Minus, Plus, Skull } from 'lucide-react';
import { useMessages } from '../i18n';
import { cutoffMsg } from './CutoffStepper.i18n';

/** "Analisar até N mortes": − [N] +. No topo o rótulo fica curto ("até 4 mortes") e some se a janela é estreita. */
export function CutoffStepper({ value, disabled, title, onChange }: { value: number; disabled: boolean; title: string; onChange: (n: number) => void }) {
  const t = useMessages(cutoffMsg);
  const set = (n: number) => onChange(Math.max(0, Math.min(40, n)));
  return (
    <div className="stepper" role="group" aria-label={t.aria} title={title}>
      <Skull size={16} strokeWidth={1.5} className="muted" aria-hidden />
      <span className="stepper-label">
        <span className="stepper-long">{t.analyze}</span>
        {t.upTo}
      </span>
      <button className="icon-btn sm" onClick={() => set(value - 1)} disabled={disabled || value <= 0} aria-label={t.less}>
        <Minus size={14} strokeWidth={2} aria-hidden />
      </button>
      <input
        className="stepper-value"
        type="number"
        min={0}
        max={40}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value) || 0)}
        aria-label={t.count}
      />
      <button className="icon-btn sm" onClick={() => set(value + 1)} disabled={disabled || value >= 40} aria-label={t.more}>
        <Plus size={14} strokeWidth={2} aria-hidden />
      </button>
      <span className="stepper-label">{t.unit(value)}</span>
    </div>
  );
}
