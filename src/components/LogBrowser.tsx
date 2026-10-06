import { useEffect, useMemo, useState } from 'react';
import { CloudDownload, FileText, FolderOpen, FolderSearch, HardDrive, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { inTauri, logsDetectDir, logsList, logsPeek, logsSetDir, pickFolder, sameLog, type HistoryEntry, type LogPeek, type LogsScan } from '../lib/api';
import { useSetup } from '../lib/setup';
import { fetchGuildReports, groupNights, saveGuildId, savedGuildId, type GuildNight } from '../lib/guildNights';
import { buildNights, completePath, downloadMinutes, type Night } from '../lib/nights';
import { BossName } from './Names';
import { WclOpen } from './WclOpen';
import { intlLocale, useMessages } from '../i18n';
import { logsMsg } from './LogBrowser.i18n';

interface Props {
  history: HistoryEntry[];
  busy: boolean;
  onAnalyze: (path: string) => void;
  /** escolher um arquivo avulso, fora da pasta */
  onOpenFile: () => void;
}

const DIFF_SHORT: Record<number, string> = { 14: 'N', 15: 'H', 16: 'M', 17: 'LFR', 1: 'N', 2: 'H', 23: 'M', 8: 'M+' };

/**
 * Noites para analisar: os logs do WoW neste PC e os reports da guilda no Warcraft Logs, juntos
 * por noite. O log do PC é o padrão (rápido e de graça); o que só existe no Warcraft Logs fica
 * marcado e baixar é escolha do usuário.
 */
export function LogBrowser({ history, busy, onAnalyze, onOpenFile }: Props) {
  const t = useMessages(logsMsg);
  const [scan, setScan] = useState<LogsScan | null>(null);
  const [peeks, setPeeks] = useState<Map<string, LogPeek | 'error'>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const setup = useSetup();
  const guild = useGuild();

  const refresh = () => {
    logsList()
      .then((s) => {
        setScan(s);
        setError(null);
      })
      .catch((e) => setError(String(e)));
    guild.reload();
  };
  useEffect(() => {
    logsList()
      .then(setScan)
      .catch((e) => setError(String(e)));
  }, []);

  // lê os encontros dos logs que ainda não estão no índice, um de cada vez (do mais novo)
  useEffect(() => {
    if (!scan || !inTauri) return;
    let alive = true;
    (async () => {
      for (const f of scan.files.filter((f) => !f.peek)) {
        const p = await logsPeek(f.path).catch(() => 'error' as const);
        if (!alive) return;
        setPeeks((m) => new Map(m).set(f.path, p));
      }
    })();
    return () => {
      alive = false;
    };
  }, [scan]);

  const files = useMemo(
    () =>
      (scan?.files ?? []).map((f) => {
        const p = f.peek ?? peeks.get(f.path);
        return { ...f, peek: p && p !== 'error' ? p : f.peek };
      }),
    [scan, peeks],
  );
  const reading = (scan?.files ?? []).filter((f) => !f.peek && !peeks.has(f.path)).length;
  const nights = useMemo(() => buildNights(files, guild.nights ?? []), [files, guild.nights]);

  async function chooseFolder() {
    if (!inTauri) return setError(t.browserNoFolders);
    const dir = await pickFolder(t.pickTitle);
    if (!dir) return;
    await logsSetDir(dir);
    setPeeks(new Map());
    refresh();
    setup.reload();
  }

  async function useDetected() {
    if (!inTauri) return;
    await logsSetDir(null);
    setPeeks(new Map());
    refresh();
    setup.reload();
  }

  if (!inTauri && !scan?.files.length) {
    return (
      <div className="logs">
        <p className="muted small">{t.browserMode()}</p>
      </div>
    );
  }

  const analyzed = (path: string) => history.some((h) => sameLog(h.logPath, path));

  return (
    <div className="logs">
      <header className="logs-head">
        <div>
          <h2>{t.title}</h2>
          {scan?.dir ? (
            <p className="muted small logs-dir">
              <HardDrive size={14} strokeWidth={1.5} aria-hidden /> <code>{scan.dir}</code>
              <span>{scan.source === 'detected' ? t.detected : t.chosen}</span>
            </p>
          ) : (
            scan && <p className="muted small">{t.noFolder}</p>
          )}
          {guild.current && (
            <p className="muted small logs-dir">
              <Users size={14} strokeWidth={1.5} aria-hidden />
              {guild.all.length > 1 ? (
                <select className="text-input sm" value={guild.current.id} aria-label={t.guild} onChange={(e) => guild.choose(Number(e.target.value))}>
                  {guild.all.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.serverName}-{g.region})
                    </option>
                  ))}
                </select>
              ) : (
                <span>
                  {guild.current.name} ({guild.current.serverName}-{guild.current.region})
                </span>
              )}
              <span>{t.wclRange}</span>
              {guild.loading && <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-label={t.searching} />}
            </p>
          )}
        </div>
        <div className="logs-actions">
          <button className="btn ghost sm" onClick={refresh} title={t.refresh} aria-label={t.refresh}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
          </button>
          {scan?.source === 'settings' && (
            <button className="btn ghost sm" onClick={useDetected} title={t.detectTitle}>
              <FolderSearch size={14} strokeWidth={1.5} aria-hidden /> {t.detect}
            </button>
          )}
          <button className="btn ghost sm" onClick={chooseFolder}>
            <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> {scan?.dir ? t.changeFolder : t.chooseFolder}
          </button>
          <button className="btn ghost sm" onClick={onOpenFile} title={t.openFileTitle}>
            <FileText size={14} strokeWidth={1.5} aria-hidden /> {t.openFile}
          </button>
        </div>
      </header>

      {error && <div className="error">{t.error(error)}</div>}
      {guild.error && <div className="error">Warcraft Logs: {guild.error}</div>}
      {scan?.warning && <p className="logs-warning small">{scan.warning}</p>}
      {scan && !scan.dir && <NoFolder onChoose={chooseFolder} />}

      {nights.length > 0 && (
        <ul className="plain log-list">
          {nights.map((n) => (
            <li key={n.key}>
              <NightRow night={n} busy={busy} analyzed={analyzed} onAnalyze={onAnalyze} />
            </li>
          ))}
        </ul>
      )}
      {reading > 0 && (
        <p className="muted small log-reading">
          <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> {t.readingLogs(reading)}
        </p>
      )}

      <WclOpen busy={busy} onAnalyze={onAnalyze} />
    </div>
  );
}

/** Guilda do login do Warcraft Logs e as noites dela. */
function useGuild() {
  const user = useSetup().status?.wcl?.user ?? null;
  const all = user?.guilds ?? [];
  const [id, setId] = useState<number | null>(() => savedGuildId());
  const current = all.find((g) => g.id === id) ?? all[0] ?? null;
  const [nights, setNights] = useState<GuildNight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);

  // dev no navegador (?demoLogs=1): uma noite da guilda com 2 bosses que o log de exemplo não tem
  useEffect(() => {
    if (!import.meta.env.DEV || inTauri || !new URLSearchParams(window.location.search).has('demoLogs')) return;
    const h = 3_600_000;
    const t = Date.now() - 2.5 * h;
    const fight = (id: number, encounterID: number, name: string, start: number, kill: boolean) => ({ id, encounterID, name, difficulty: 5, kill, startTime: start, endTime: start + 6 * 60_000 });
    setNights(
      groupNights(
        [
          {
            code: 'DEMOdemo01',
            title: '',
            startTime: t,
            endTime: t + 3 * h,
            owner: 'Fulano',
            zone: 'VA',
            fights: [fight(1, 3455, 'Vashnik the Malignant', 2.6 * h, false), fight(2, 3455, 'Vashnik the Malignant', 2.75 * h, true), fight(3, 3497, 'The Lost Explorers', 2.9 * h, true)],
          },
        ],
        t + 10 * h,
      ),
    );
  }, []);

  useEffect(() => {
    if (!current || !inTauri) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchGuildReports(current)
      .then((r) => alive && setNights(groupNights(r)))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [current?.id, n]);

  return {
    all,
    current,
    nights,
    error,
    loading,
    reload: () => setN((x) => x + 1),
    choose: (g: number) => {
      setId(g);
      saveGuildId(g);
    },
  };
}

function NoFolder({ onChoose }: { onChoose: () => void }) {
  const t = useMessages(logsMsg);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    logsDetectDir().then(setHint).catch(() => {});
  }, []);
  return (
    <div className="panel logs-setup">
      <p>{t.setupText(hint ?? 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs')}</p>
      <button className="btn primary" onClick={onChoose}>
        <FolderOpen size={16} strokeWidth={2} aria-hidden /> {t.chooseLogsFolder}
      </button>
    </div>
  );
}

function when(ms: number) {
  const d = new Date(ms);
  const day = d.toLocaleDateString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  const hm = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  return { day, hm };
}

function size(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function NightRow({ night: n, busy, analyzed, onAnalyze }: { night: Night; busy: boolean; analyzed: (path: string) => boolean; onAnalyze: (path: string) => void }) {
  const t = useMessages(logsMsg);
  const [confirm, setConfirm] = useState(false);
  const start = when(n.startMs);
  const end = when(n.endMs).hm;
  const local = n.files[0] ?? null;
  const full = completePath(n);
  const missingBosses = n.bosses.filter((b) => b.local === 0).length;
  const reading = local != null && !local.peek;
  const owners = [...new Set(n.wcl?.reports.map((r) => r.owner).filter(Boolean) ?? [])];
  const done = (local && analyzed(local.path)) || (full != null && analyzed(full));

  return (
    <article className={`night-row ${n.bosses.length === 0 && !reading ? 'empty-log' : ''}`}>
      <span className="log-when">
        <strong>{start.day}</strong>
        <span className="muted small">
          {start.hm}
          {end !== start.hm ? ` → ${end}` : ''}
        </span>
      </span>

      <div className="night-main">
        <span className="log-bosses">
          {reading ? (
            <span className="muted small log-reading">
              <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> {t.readingEncounters}
            </span>
          ) : n.bosses.length === 0 ? (
            <span className="muted small">{t.noRaidBosses}</span>
          ) : (
            n.bosses.map((b) => {
              const onlyWcl = b.local === 0;
              const pulls = b.local + b.missing;
              return (
                <span
                  key={`${b.encounterId}-${b.difficultyId}`}
                  className={`log-boss ${onlyWcl ? 'wcl-only' : ''}`}
                  title={onlyWcl ? t.onlyWclTitle : b.missing > 0 ? t.missingTitle(b.missing) : undefined}
                >
                  {b.missing > 0 && <CloudDownload size={13} strokeWidth={1.75} className="wcl-mark" aria-label={t.needsDownload} />}
                  <strong>
                    <BossName encounterId={b.encounterId} name={b.name} size={16} />
                  </strong>{' '}
                  <span className="muted">{DIFF_SHORT[b.difficultyId] ?? ''}</span>
                  <span className="muted small">
                    {' '}
                    · {t.pulls(pulls)}
                    {b.localKills + b.missingKills > 0 && <span className="log-kill"> · kill</span>}
                    {b.missing > 0 && !onlyWcl && <span className="wcl-mark">{t.plusWcl(b.missing)}</span>}
                  </span>
                </span>
              );
            })
          )}
          {n.dungeonBosses > 0 && (
            <span className="muted small log-dungeons">
              {n.bosses.length ? '+ ' : ''}
              {t.dungeons(n.dungeonBosses)}
            </span>
          )}
        </span>

        <span className="muted small night-sources">
          {local ? (
            <span title={local.path}>
              <HardDrive size={12} strokeWidth={1.5} aria-hidden /> {local.name} · {size(local.size)}
              {local.folder && ` · ${local.folder}`}
            </span>
          ) : (
            <span>
              <HardDrive size={12} strokeWidth={1.5} aria-hidden /> {t.notOnPc}
            </span>
          )}
          {n.wcl && (
            <span title={n.wcl.reports.map((r) => r.code).join(', ')}>
              <CloudDownload size={12} strokeWidth={1.5} aria-hidden /> {t.wclReports(n.wcl.reports.length)}
              {owners.length > 0 && t.from(owners.join(', '))}
            </span>
          )}
        </span>

        {n.missingPulls > 0 && local && !confirm && (
          <p className="night-gap small">{t.gap(missingBosses, n.missingPulls)}</p>
        )}
        {confirm && full && (
          <div className="night-confirm small">
            <p>{t.confirm(n.missingPulls, downloadMinutes(n), !!local)}</p>
            <div className="night-actions">
              <button
                className="btn primary sm"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                  onAnalyze(full);
                }}
              >
                <CloudDownload size={14} strokeWidth={1.75} aria-hidden /> {t.downloadAnalyze}
              </button>
              <button className="btn ghost sm" onClick={() => setConfirm(false)}>
                {t.cancel}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="night-side">
        <span className="log-tags">
          {n.live && <span className="log-tag live">{local && Date.now() - local.modifiedMs < 15 * 60_000 ? t.inProgress : t.live}</span>}
          {done && <span className="log-tag">{t.analyzed}</span>}
        </span>
        {!confirm && (
          <div className="night-actions">
            {local && (
              <button className="btn sm" disabled={busy} onClick={() => onAnalyze(local.path)} title={t.analyzeTitle}>
                {t.analyze}
              </button>
            )}
            {full && n.missingPulls > 0 && (
              <button
                className={`btn sm ${local ? 'ghost' : ''}`}
                disabled={busy}
                onClick={() => setConfirm(true)}
                title={local ? t.completeTitle : t.downloadTitle}
              >
                <CloudDownload size={14} strokeWidth={1.75} aria-hidden /> {local ? t.complete : t.download}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
