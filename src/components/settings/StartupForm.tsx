import { useState } from 'react';
import { startupSet } from '../../lib/api';

/** "Ligar o ao vivo quando o WoW abrir": com o app fechado, o WoW abre o Wipe Cause na bandeja já ao vivo. */
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
        Ligar o ao vivo quando o WoW abrir
      </label>
      <p className="muted small">
        Mesmo com o app fechado: quando o <code>Wow.exe</code> abre, o Wipe Cause abre minimizado na bandeja (perto do relógio) e liga o modo ao
        vivo, sem abrir a janela. Para isso, um vigia leve (sem janela) inicia com o Windows e só olha se o WoW abriu.
      </p>
      {error && <p className="small bad">{error}</p>}
    </>
  );
}
