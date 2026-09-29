import { useState } from 'react';
import { Radio, Square } from 'lucide-react';
import type { LiveStatus } from '../lib/api';
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
