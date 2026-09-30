import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Pull } from '../types';
import { pct } from '../lib/format';
import { lowestBossHp } from '../lib/verdict';
import { mechanicSpellId } from '../lib/spells';
import { useNote } from '../lib/notes';
import { SpellName } from './SpellIcon';
import { BossName } from './Names';

/** Tempo na tela: dá para ler entre um pull e outro sem ficar no caminho. */
const SHOW_MS = 20_000;

/**
 * Aviso no canto quando o modo ao vivo termina de analisar um pull, com um campo para anotar o
 * motivo do wipe na hora. Enquanto a pessoa escreve, o aviso não some sozinho.
 */
export function LiveToast({ pull: p, discord, onOpen, onClose }: { pull: Pull; discord: string | null; onOpen: () => void; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  const [note, setNote] = useNote(p);
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    setHolding(false);
  }, [p]);
  useEffect(() => {
    if (holding) return;
    const id = window.setTimeout(() => close.current(), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [p, holding]);

  const hp = lowestBossHp(p);
  return (
    <div className={`live-toast ${p.success ? 'kill' : 'wipe'}`} role="status">
      <div className="live-toast-row">
        <div className="live-toast-body">
          <strong>
            <BossName encounterId={p.encounterId} name={p.success ? `Kill! ${p.encounterName}` : `Pull ${p.pullNumber} · ${p.encounterName}${hp != null ? ` — ${pct(hp)}` : ''}`} size={18} />
          </strong>
          {!p.success && p.trigger && (
            <span className="small">
              Gatilho: <SpellName spellId={mechanicSpellId(p, p.trigger.key)} name={p.trigger.name} size={14} />
            </span>
          )}
          {discord && <span className="small muted">{discord}</span>}
        </div>
        <button className="btn sm" onClick={onOpen}>
          Ver
        </button>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fechar">
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <input
        className="text-input live-note"
        value={note}
        placeholder={p.success ? 'Anotação (opcional)' : 'Motivo do wipe ou anotação…'}
        aria-label="Anotação do pull"
        onFocus={() => setHolding(true)}
        onChange={(e) => {
          setHolding(true);
          setNote(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onClose(); // já está salva; Enter só fecha
          if (e.key === 'Escape') onClose();
        }}
      />
    </div>
  );
}
