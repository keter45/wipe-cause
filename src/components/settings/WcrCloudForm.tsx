import { useState } from 'react';
import { Cloud } from 'lucide-react';
import { wcrCloudSetConfig, type WcrCloudConfig } from '../../lib/api';
import { useMessages } from '../../i18n';
import { wcrCloudMsg } from './WcrCloudForm.i18n';

/**
 * Nuvem do Warcraft Recorder: com a conta (a mesma do Recorder), os vídeos que a guilda sobe
 * viram outros pontos de vista de cada pull. Precisa da assinatura de nuvem do Recorder.
 */
export function WcrCloudForm({ current, onSaved }: { current: WcrCloudConfig | null; onSaved: () => void }) {
  const t = useMessages(wcrCloudMsg);
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
        setMsg({ ok: true, text: t.disconnected });
      } else if (!next.guild.trim() && available.length > 1) {
        setGuilds(available);
        setMsg({ ok: true, text: t.pickGuild });
        return;
      } else {
        setPass('');
        setGuilds(available);
        setMsg({ ok: true, text: t.connected });
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
        <Cloud size={14} strokeWidth={1.75} aria-hidden /> {t.title}
      </h4>
      <p className="muted small">{t.text}</p>
      <div className="field-row">
        <label className="field">
          {t.user}
          <input className="text-input" value={user} spellCheck={false} autoComplete="off" onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="field">
          {t.password}
          <input
            className="text-input"
            type="password"
            value={pass}
            autoComplete="off"
            placeholder={current?.configured ? t.passwordSaved : ''}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="field">
          {t.guild}
          {guilds.length > 1 ? (
            <select className="text-input" value={guild} onChange={(e) => setGuild(e.target.value)}>
              <option value="">{t.choose}</option>
              {guilds.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : (
            <input className="text-input" value={guild} spellCheck={false} placeholder={t.guildHint} onChange={(e) => setGuild(e.target.value)} />
          )}
        </label>
      </div>
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn primary sm" onClick={() => save()} disabled={busy || !user.trim() || (!pass && !current?.configured)}>
          {busy ? t.checking : current?.configured ? t.save : t.connect}
        </button>
        {current?.configured && (
          <button className="btn ghost sm" onClick={() => save({ user: '', pass: '', guild: '' })} disabled={busy}>
            {t.disconnect}
          </button>
        )}
      </div>
    </div>
  );
}
