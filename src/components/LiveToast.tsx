import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Pull } from '../types';
import { pct } from '../lib/format';
import { lowestBossHp } from '../lib/verdict';

/** Tempo na tela: dá para ler entre um pull e outro sem ficar no caminho. */
const SHOW_MS = 20_000;

/** Aviso no canto quando o modo ao vivo termina de analisar um pull. */
export function LiveToast({ pull: p, discord, onOpen, onClose }: { pull: Pull; discord: string | null; onOpen: () => void; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = window.setTimeout(() => close.current(), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [p]);

  const hp = lowestBossHp(p);
  return (
    <div className={`live-toast ${p.success ? 'kill' : 'wipe'}`} role="status">
      <div className="live-toast-body">
        <strong>{p.success ? `Kill! ${p.encounterName}` : `Pull ${p.pullNumber} · ${p.encounterName}${hp != null ? ` — ${pct(hp)}` : ''}`}</strong>
        {!p.success && p.trigger && <span className="small">Gatilho: {p.trigger.name}</span>}
        {discord && <span className="small muted">{discord}</span>}
      </div>
      <button className="btn sm" onClick={onOpen}>
        Ver
      </button>
      <button className="icon-btn sm" onClick={onClose} aria-label="Fechar">
        <X size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
