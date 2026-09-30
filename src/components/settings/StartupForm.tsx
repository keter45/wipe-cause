import { useState } from 'react';
import { startupSet } from '../../lib/api';

/** "Abrir o Wipe Cause quando o WoW abrir": o app inicia com o Windows, na bandeja, e aparece com o WoW. */
export function StartupForm({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
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
        Abrir o Wipe Cause quando o WoW abrir
      </label>
      <p className="muted small">
        Para isso o app inicia com o Windows, escondido na bandeja (perto do relógio), e aparece quando o <code>Wow.exe</code> abre. Com o{' '}
        <em>ao vivo automático</em> ligado, ele já começa a acompanhar a raid.
      </p>
      {error && <p className="small bad">{error}</p>}
    </>
  );
}
