import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { sameLog, type HistoryEntry } from '../lib/api';
import { useSetup } from '../lib/setup';
import { fetchGuildReports, groupNights, saveGuildId, savedGuildId, type GuildNight } from '../lib/guildNights';
import { BossName } from './Names';

/** Dificuldade do WCL -> rótulo curto. */
const DIFF_SHORT: Record<number, string> = { 1: 'LFR', 3: 'N', 4: 'H', 5: 'M' };

/**
 * Noites da guilda no Warcraft Logs (com o login da pessoa): escolher a noite, em vez de ter o
 * log no PC ou colar link. Reports da mesma noite viram uma análise só.
 */
export function GuildNights({ history, busy, onAnalyze }: { history: HistoryEntry[]; busy: boolean; onAnalyze: (path: string) => void }) {
  const user = useSetup().status?.wcl?.user ?? null;
  const guilds = user?.guilds ?? [];
  const [guildId, setGuildId] = useState<number | null>(() => savedGuildId());
  const guild = guilds.find((g) => g.id === guildId) ?? guilds[0] ?? null;
  const [nights, setNights] = useState<GuildNight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!guild) return;
    setLoading(true);
    setError(null);
    fetchGuildReports(guild)
      .then((r) => setNights(groupNights(r)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [guild?.id]);

  if (!user) return null;
  if (!guild) {
    return <p className="muted small">Sua conta do Warcraft Logs não está em nenhuma guilda; cole o link de um report abaixo.</p>;
  }

  const analyzed = (n: GuildNight) => history.some((h) => sameLog(h.logPath, n.path));

  return (
    <section className="guild-nights">
      <header className="logs-head">
        <div>
          <h2>Noites da guilda</h2>
          <p className="muted small logs-dir">
            <Users size={14} strokeWidth={1.5} aria-hidden />
            {guilds.length > 1 ? (
              <select
                className="text-input sm"
                value={guild.id}
                aria-label="Guilda"
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setGuildId(id);
                  saveGuildId(id);
                }}
              >
                {guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.serverName}-{g.region})
                  </option>
                ))}
              </select>
            ) : (
              <span>
                {guild.name} ({guild.serverName}-{guild.region})
              </span>
            )}
            <span>· últimos 30 dias no Warcraft Logs</span>
          </p>
        </div>
        <div className="logs-actions">
          <button className="btn ghost sm" onClick={load} disabled={loading} title="Atualizar" aria-label="Atualizar as noites da guilda">
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </header>
      {error && <div className="error">Erro: {error}</div>}
      {nights == null && !error && (
        <p className="muted small log-reading">
          <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> buscando os reports da guilda…
        </p>
      )}
      {nights?.length === 0 && <p className="muted small">Nenhum report com boss nos últimos 30 dias.</p>}
      {nights && nights.length > 0 && (
        <ul className="plain log-list">
          {nights.map((n) => (
            <li key={n.path}>
              <NightRow night={n} analyzed={analyzed(n)} disabled={busy} onClick={() => onAnalyze(n.path)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function when(ms: number) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return { day, hm };
}

function NightRow({ night: n, analyzed, disabled, onClick }: { night: GuildNight; analyzed: boolean; disabled: boolean; onClick: () => void }) {
  const start = when(n.startTime);
  const end = when(n.endTime).hm;
  const owners = [...new Set(n.reports.map((r) => r.owner).filter(Boolean))];
  return (
    <button className="log-row" onClick={onClick} disabled={disabled} title={n.reports.map((r) => r.code).join(', ')}>
      <span className="log-when">
        <strong>{start.day}</strong>
        <span className="muted small">
          {start.hm}
          {end !== start.hm ? ` → ${end}` : ''}
        </span>
      </span>
      <span className="log-bosses">
        {n.bosses.map((b) => (
          <span key={`${b.encounterId}-${b.difficulty}`} className="log-boss">
            <strong>
              <BossName encounterId={b.encounterId} name={b.name} size={16} />
            </strong>{' '}
            <span className="muted">{DIFF_SHORT[b.difficulty] ?? ''}</span>
            <span className="muted small">
              {' '}
              · {b.pulls} pull{b.pulls > 1 ? 's' : ''}
              {b.kills > 0 && <span className="log-kill"> · kill</span>}
            </span>
          </span>
        ))}
        <span className="muted small log-file">
          {n.reports.length > 1 ? `${n.reports.length} reports juntados` : '1 report'}
          {owners.length > 0 && ` · de ${owners.join(', ')}`}
        </span>
      </span>
      <span className="log-tags">
        {n.live && <span className="log-tag live">ao vivo</span>}
        {analyzed && <span className="log-tag">analisado</span>}
      </span>
    </button>
  );
}
