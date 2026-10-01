import { useState } from 'react';
import { Cloud } from 'lucide-react';
import { wcrCloudSetConfig, type WcrCloudConfig } from '../../lib/api';

/**
 * Nuvem do Warcraft Recorder: com a conta (a mesma do Recorder), os vídeos que a guilda sobe
 * viram outros pontos de vista de cada pull. Precisa da assinatura de nuvem do Recorder.
 */
export function WcrCloudForm({ current, onSaved }: { current: WcrCloudConfig | null; onSaved: () => void }) {
  const [user, setUser] = useState(current?.user ?? '');
  const [pass, setPass] = useState('');
  const [guild, setGuild] = useState(current?.guild ?? '');
  const [guilds, setGuilds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next = { user, pass, guild }) {
    setBusy(true);
    setMsg(null);
    try {
      const available = await wcrCloudSetConfig(next.user, next.pass, next.guild);
      if (!next.user.trim()) {
        setMsg({ ok: true, text: 'Desconectado da nuvem.' });
      } else if (!next.guild.trim() && available.length > 1) {
        setGuilds(available);
        setMsg({ ok: true, text: 'A conta está em mais de uma guilda: escolha qual.' });
        return;
      } else {
        setPass('');
        setGuilds(available);
        setMsg({ ok: true, text: 'Conectado: os vídeos da guilda aparecem como outros POVs dos pulls.' });
      }
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wcr-cloud">
      <h4>
        <Cloud size={14} strokeWidth={1.75} aria-hidden /> Vídeos da guilda na nuvem
      </h4>
      <p className="muted small">
        Quem tem a nuvem do Warcraft Recorder e sobe os vídeos vira mais um ponto de vista de cada pull (troque de POV no player). Use a conta da
        nuvem do Recorder; a senha fica no cofre do Windows.
      </p>
      <div className="field-row">
        <label className="field">
          Usuário
          <input className="text-input" value={user} spellCheck={false} autoComplete="off" onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="field">
          Senha
          <input
            className="text-input"
            type="password"
            value={pass}
            autoComplete="off"
            placeholder={current?.configured ? '•••••••• (guardada)' : ''}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="field">
          Guilda na nuvem
          {guilds.length > 1 ? (
            <select className="text-input" value={guild} onChange={(e) => setGuild(e.target.value)}>
              <option value="">Escolha…</option>
              {guilds.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : (
            <input className="text-input" value={guild} spellCheck={false} placeholder="(se tiver só uma, pode deixar vazio)" onChange={(e) => setGuild(e.target.value)} />
          )}
        </label>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn primary sm" onClick={() => save()} disabled={busy || !user.trim() || (!pass && !current?.configured)}>
          {busy ? 'Conferindo…' : current?.configured ? 'Salvar' : 'Conectar'}
        </button>
        {current?.configured && (
          <button className="btn ghost sm" onClick={() => save({ user: '', pass: '', guild: '' })} disabled={busy}>
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
}
