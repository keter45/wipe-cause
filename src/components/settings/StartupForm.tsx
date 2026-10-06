import { useState } from 'react';
import { startupSet } from '../../lib/api';
import { useMessages } from '../../i18n';
import { startupMsg } from '../misc.i18n';

/** "Ligar o ao vivo quando o WoW abrir": com o app fechado, o WoW abre o Wipe Cause na bandeja já ao vivo. */
export function StartupForm({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  const t = useMessages(startupMsg);
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setOn(next);
    setError(null);
    try {
      await startupSet(next);
      onSaved();
    } catch (e) {
      setOn(!next);
      setError(String(e));
    }
  }

  return (
    <>
      <label className="auto-live small">
        <span className="switch">
          <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} />
          <span aria-hidden />
        </span>
        {t.label}
      </label>
      <p className="muted small">{t.text()}</p>
      {error && <p className="small bad">{error}</p>}
    </>
  );
}
