import { useEffect, useMemo, useState } from 'react';
import { CloudDownload, FileText, FolderOpen, FolderSearch, HardDrive, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { inTauri, logsDetectDir, logsList, logsPeek, logsSetDir, pickFolder, sameLog, type HistoryEntry, type LogPeek, type LogsScan } from '../lib/api';
import { useSetup } from '../lib/setup';
import { fetchGuildReports, groupNights, saveGuildId, savedGuildId, type GuildNight } from '../lib/guildNights';
import { buildNights, completePath, downloadMinutes, type Night } from '../lib/nights';
import { BossName } from './Names';
import { WclOpen } from './WclOpen';

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
    if (!inTauri) return setError('No navegador não dá para escolher pastas: use o app.');
    const dir = await pickFolder('Pasta de logs do WoW (World of Warcraft\\_retail_\\Logs)');
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
        <p className="muted small">
          Modo navegador: gere o relatório com <code>wipe-cli analyze log.txt --json</code> e abra o JSON pela barra lateral (ou use{' '}
          <code>?demoLogs=1</code> para ver esta tela).
        </p>
      </div>
    );
  }

  const analyzed = (path: string) => history.some((h) => sameLog(h.logPath, path));

  return (
    <div className="logs">
      <header className="logs-head">
        <div>
          <h2>Escolha a noite</h2>
          {scan?.dir ? (
            <p className="muted small logs-dir">
              <HardDrive size={14} strokeWidth={1.5} aria-hidden /> <code>{scan.dir}</code>
              <span>{scan.source === 'detected' ? '· detectada automaticamente' : '· escolhida por você'}</span>
            </p>
          ) : (
            scan && <p className="muted small">Pasta de logs ainda não definida.</p>
          )}
          {guild.current && (
            <p className="muted small logs-dir">
              <Users size={14} strokeWidth={1.5} aria-hidden />
              {guild.all.length > 1 ? (
                <select className="text-input sm" value={guild.current.id} aria-label="Guilda" onChange={(e) => guild.choose(Number(e.target.value))}>
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
              <span>· Warcraft Logs, últimos 30 dias</span>
              {guild.loading && <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-label="buscando" />}
            </p>
          )}
        </div>
        <div className="logs-actions">
          <button className="btn ghost sm" onClick={refresh} title="Atualizar a lista" aria-label="Atualizar a lista">
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
          </button>
          {scan?.source === 'settings' && (
            <button className="btn ghost sm" onClick={useDetected} title="Voltar para a pasta do WoW detectada automaticamente">
              <FolderSearch size={14} strokeWidth={1.5} aria-hidden /> Detectar
            </button>
          )}
          <button className="btn ghost sm" onClick={chooseFolder}>
            <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> {scan?.dir ? 'Trocar pasta' : 'Escolher pasta'}
          </button>
          <button className="btn ghost sm" onClick={onOpenFile} title="Abrir um arquivo de log de outro lugar">
            <FileText size={14} strokeWidth={1.5} aria-hidden /> Abrir arquivo…
          </button>
        </div>
      </header>

      {error && <div className="error">Erro: {error}</div>}
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
          <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> lendo os encontros de {reading} log{reading > 1 ? 's' : ''}…
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
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    logsDetectDir().then(setHint).catch(() => {});
  }, []);
  return (
    <div className="panel logs-setup">
      <p>
        Escolha a pasta <code>Logs</code> da instalação do WoW, por exemplo <code>{hint ?? 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Logs'}</code>. Os logs
        aparecem aqui, com os bosses de cada noite.
      </p>
      <button className="btn primary" onClick={onChoose}>
        <FolderOpen size={16} strokeWidth={2} aria-hidden /> Escolher pasta de logs
      </button>
    </div>
  );
}

function when(ms: number) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return { day, hm };
}

function size(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function NightRow({ night: n, busy, analyzed, onAnalyze }: { night: Night; busy: boolean; analyzed: (path: string) => boolean; onAnalyze: (path: string) => void }) {
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
              <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> lendo encontros…
            </span>
          ) : n.bosses.length === 0 ? (
            <span className="muted small">sem bosses de raid</span>
          ) : (
            n.bosses.map((b) => {
              const onlyWcl = b.local === 0;
              const pulls = b.local + b.missing;
              return (
                <span
                  key={`${b.encounterId}-${b.difficultyId}`}
                  className={`log-boss ${onlyWcl ? 'wcl-only' : ''}`}
                  title={onlyWcl ? 'Só no Warcraft Logs: não está no log do seu PC' : b.missing > 0 ? `${plural(b.missing, 'pull', 'pulls')} só no Warcraft Logs` : undefined}
                >
                  {b.missing > 0 && <CloudDownload size={13} strokeWidth={1.75} className="wcl-mark" aria-label="precisa baixar" />}
                  <strong>
                    <BossName encounterId={b.encounterId} name={b.name} size={16} />
                  </strong>{' '}
                  <span className="muted">{DIFF_SHORT[b.difficultyId] ?? ''}</span>
                  <span className="muted small">
                    {' '}
                    · {plural(pulls, 'pull', 'pulls')}
                    {b.localKills + b.missingKills > 0 && <span className="log-kill"> · kill</span>}
                    {b.missing > 0 && !onlyWcl && <span className="wcl-mark"> · +{b.missing} no WCL</span>}
                  </span>
                </span>
              );
            })
          )}
          {n.dungeonBosses > 0 && (
            <span className="muted small log-dungeons">
              {n.bosses.length ? '+ ' : ''}
              {plural(n.dungeonBosses, 'chefe de masmorra (M+)', 'chefes de masmorra (M+)')}
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
              <HardDrive size={12} strokeWidth={1.5} aria-hidden /> não está no seu PC
            </span>
          )}
          {n.wcl && (
            <span title={n.wcl.reports.map((r) => r.code).join(', ')}>
              <CloudDownload size={12} strokeWidth={1.5} aria-hidden /> Warcraft Logs: {plural(n.wcl.reports.length, 'report', 'reports')}
              {owners.length > 0 && ` de ${owners.join(', ')}`}
            </span>
          )}
        </span>

        {n.missingPulls > 0 && local && !confirm && (
          <p className="night-gap small">
            O log do seu PC não tem{' '}
            {missingBosses > 0 ? `${plural(missingBosses, 'boss', 'bosses')} (${plural(n.missingPulls, 'pull', 'pulls')})` : plural(n.missingPulls, 'pull', 'pulls')} desta noite: estão
            no Warcraft Logs.
          </p>
        )}
        {confirm && full && (
          <div className="night-confirm small">
            <p>
              Baixar {plural(n.missingPulls, 'pull', 'pulls')} do Warcraft Logs — cerca de {downloadMinutes(n)} min.
              {local ? ' O resto vem do log do seu PC.' : ' Esta noite não está no seu PC.'} Depois do primeiro download, reabrir é rápido.
            </p>
            <div className="night-actions">
              <button
                className="btn primary sm"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                  onAnalyze(full);
                }}
              >
                <CloudDownload size={14} strokeWidth={1.75} aria-hidden /> Baixar e analisar
              </button>
              <button className="btn ghost sm" onClick={() => setConfirm(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="night-side">
        <span className="log-tags">
          {n.live && <span className="log-tag live">{local && Date.now() - local.modifiedMs < 15 * 60_000 ? 'em andamento' : 'ao vivo'}</span>}
          {done && <span className="log-tag">analisado</span>}
        </span>
        {!confirm && (
          <div className="night-actions">
            {local && (
              <button className="btn sm" disabled={busy} onClick={() => onAnalyze(local.path)} title="Analisar o log do seu PC (rápido, sem baixar nada)">
                Analisar
              </button>
            )}
            {full && n.missingPulls > 0 && (
              <button
                className={`btn sm ${local ? 'ghost' : ''}`}
                disabled={busy}
                onClick={() => setConfirm(true)}
                title={local ? 'Completar com os pulls que só estão no Warcraft Logs' : 'Baixar a noite do Warcraft Logs'}
              >
                <CloudDownload size={14} strokeWidth={1.75} aria-hidden /> {local ? 'Completar' : 'Baixar'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
