import { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { UpdateState } from '../lib/updater';

interface Props {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}

/** Faixa abaixo do header quando há versão nova (ou durante o download). */
export function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  const [showNotes, setShowNotes] = useState(false);
  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'error') return null;

  if (state.kind === 'error') {
    return (
      <div className="update-banner error-tone" role="status">
        <span>Não foi possível atualizar: {state.message}</span>
        <button className="icon-btn sm" onClick={onDismiss} aria-label="Fechar">
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    );
  }

  if (state.kind === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span>
          Baixando a versão <strong>{state.version}</strong>
          {state.fraction != null && ` — ${Math.round(state.fraction * 100)}%`}. O app reinicia sozinho ao terminar.
        </span>
        <span className="update-meter" aria-hidden>
          <span style={{ transform: `scaleX(${state.fraction ?? 0.1})` }} />
        </span>
      </div>
    );
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-main">
        <span>
          Nova versão <strong>{state.version}</strong> disponível.
        </span>
        {state.notes && (
          <button className="link-btn" onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>
            {showNotes ? 'Esconder novidades' : 'Ver novidades'}
          </button>
        )}
        <span className="update-actions">
          <button className="btn primary sm" onClick={onInstall}>
            <Download size={14} strokeWidth={2} aria-hidden /> Atualizar e reiniciar
          </button>
          <button className="btn ghost sm" onClick={onDismiss}>
            Depois
          </button>
        </span>
      </div>
      {showNotes && <pre className="update-notes">{state.notes}</pre>}
    </div>
  );
}
