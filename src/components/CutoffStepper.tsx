import { Minus, Plus, Skull } from 'lucide-react';

/** "Analisar até N mortes": − [N] +. No topo o rótulo fica curto ("até 4 mortes") e some se a janela é estreita. */
export function CutoffStepper({ value, disabled, title, onChange }: { value: number; disabled: boolean; title: string; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(40, n)));
  return (
    <div className="stepper" role="group" aria-label="Ignorar eventos após N mortes" title={title}>
      <Skull size={16} strokeWidth={1.5} className="muted" aria-hidden />
      <span className="stepper-label">
        <span className="stepper-long">Analisar </span>até
      </span>
      <button className="icon-btn sm" onClick={() => set(value - 1)} disabled={disabled || value <= 0} aria-label="Menos uma morte">
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
        aria-label="Número de mortes"
      />
      <button className="icon-btn sm" onClick={() => set(value + 1)} disabled={disabled || value >= 40} aria-label="Mais uma morte">
        <Plus size={14} strokeWidth={2} aria-hidden />
      </button>
      <span className="stepper-label">{value === 0 ? 'mortes (desligado)' : value === 1 ? 'morte' : 'mortes'}</span>
    </div>
  );
}
