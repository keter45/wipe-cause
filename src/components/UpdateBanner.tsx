import { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { UpdateState } from '../lib/updater';
import { useMessages } from '../i18n';
import { updateMsg } from './misc.i18n';

interface Props {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}

/** Faixa abaixo do header quando há versão nova (ou durante o download). */
export function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  const t = useMessages(updateMsg);
  const [showNotes, setShowNotes] = useState(false);
  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'error') return null;

  if (state.kind === 'error') {
    return (
      <div className="update-banner error-tone" role="status">
        <span>{t.failed(state.message)}</span>
        <button className="icon-btn sm" onClick={onDismiss} aria-label={t.close}>
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    );
  }

  if (state.kind === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span>{t.downloading(state.version, state.fraction != null ? ` — ${Math.round(state.fraction * 100)}%` : '')}</span>
        <span className="update-meter" aria-hidden>
          <span style={{ transform: `scaleX(${state.fraction ?? 0.1})` }} />
        </span>
      </div>
    );
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-main">
        <span>{t.available(state.version)}</span>
        {state.notes && (
          <button className="link-btn" onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}>
            {showNotes ? t.hideNotes : t.showNotes}
          </button>
        )}
        <span className="update-actions">
          <button className="btn primary sm" onClick={onInstall}>
            <Download size={14} strokeWidth={2} aria-hidden /> {t.install}
          </button>
          <button className="btn ghost sm" onClick={onDismiss}>
            {t.later}
          </button>
        </span>
      </div>
      {showNotes && <pre className="update-notes">{state.notes}</pre>}
    </div>
  );
}
