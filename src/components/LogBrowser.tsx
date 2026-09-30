import { useEffect, useState } from 'react';
import { FileText, FolderOpen, FolderSearch, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  inTauri,
  logsDetectDir,
  logsList,
  logsPeek,
  logsSetDir,
  pickFolder,
  sameLog,
  type HistoryEntry,
  type LogFile,
  type LogPeek,
  type LogsScan,
} from '../lib/api';
import { useSetup } from '../lib/setup';
import { dungeonsOnly, raidOnly } from '../lib/content';
import { BossName } from './Names';
import { WclOpen } from './WclOpen';
import { GuildNights } from './GuildNights';

interface Props {
  history: HistoryEntry[];
  busy: boolean;
  onAnalyze: (path: string) => void;
  /** escolher um arquivo avulso, fora da pasta */
  onOpenFile: () => void;
}

/** Log modificado há menos disso = raid em andamento (o WoW ainda está escrevendo). */
const LIVE_MS = 15 * 60_000;

const DIFF_SHORT: Record<number, string> = { 14: 'N', 15: 'H', 16: 'M', 17: 'LFR', 1: 'N', 2: 'H', 23: 'M', 8: 'M+' };

/** Lista os combat logs da pasta do WoW para escolher qual analisar. */
export function LogBrowser({ history, busy, onAnalyze, onOpenFile }: Props) {
  const [scan, setScan] = useState<LogsScan | null>(null);
  const [peeks, setPeeks] = useState<Map<string, LogPeek | 'error'>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const setup = useSetup();

  const refresh = () =>
    logsList()
      .then((s) => {
        setScan(s);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
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

  const analyzed = (f: LogFile) => history.some((h) => sameLog(h.logPath, f.path));

  return (
    <div className="logs">
      <header className="logs-head">
        <div>
          <h2>Escolha o log da raid</h2>
          {scan?.dir ? (
            <p className="muted small logs-dir">
              <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> <code>{scan.dir}</code>
              <span>{scan.source === 'detected' ? '· detectada automaticamente' : '· escolhida por você'}</span>
            </p>
          ) : (
            scan && <p className="muted small">Pasta de logs ainda não definida.</p>
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
      {scan?.warning && <p className="logs-warning small">{scan.warning}</p>}

      <GuildNights history={history} busy={busy} onAnalyze={onAnalyze} />
      <WclOpen busy={busy} onAnalyze={onAnalyze} />

      {scan && !scan.dir && <NoFolder onChoose={chooseFolder} />}

      {scan && scan.files.length > 0 && (
        <ul className="plain log-list">
          {scan.files.map((f) => {
            const peek = f.peek ?? peeks.get(f.path) ?? (inTauri ? undefined : 'error');
            return (
              <li key={f.path}>
                <LogRow file={f} peek={peek} analyzed={analyzed(f)} disabled={busy} onClick={() => onAnalyze(f.path)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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

function LogRow({ file: f, peek, analyzed, disabled, onClick }: { file: LogFile; peek: LogPeek | 'error' | undefined; analyzed: boolean; disabled: boolean; onClick: () => void }) {
  const p = peek && peek !== 'error' ? peek : null;
  const start = when(p?.firstMs ?? f.modifiedMs);
  const end = p?.lastMs ? when(p.lastMs).hm : null;
  const live = Date.now() - f.modifiedMs < LIVE_MS;
  const empty = p != null && p.encounters.length === 0;
  // o app é para raid: masmorras (M+) viram só uma contagem no fim
  const raidEnc = p ? raidOnly(p.encounters) : [];
  const dungeonEnc = p ? dungeonsOnly(p.encounters) : [];

  return (
    <button className={`log-row ${empty ? 'empty-log' : ''}`} onClick={onClick} disabled={disabled} title={f.path}>
      <span className="log-when">
        <strong>{start.day}</strong>
        <span className="muted small">
          {start.hm}
          {end && end !== start.hm ? ` → ${end}` : ''}
        </span>
      </span>
      <span className="log-bosses">
        {peek === undefined ? (
          <span className="muted small log-reading">
            <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> lendo encontros…
          </span>
        ) : peek === 'error' ? (
          <span className="muted small">não foi possível ler</span>
        ) : empty ? (
          <span className="muted small">sem encontros de boss</span>
        ) : (
          raidEnc.map((e) => (
            <span key={`${e.name}-${e.difficultyId}`} className="log-boss">
              <strong>
                <BossName encounterId={e.encounterId} name={e.name} size={16} />
              </strong>{' '}
              <span className="muted">{DIFF_SHORT[e.difficultyId] ?? e.difficultyName}</span>
              <span className="muted small">
                {' '}
                · {e.pulls} pull{e.pulls > 1 ? 's' : ''}
                {e.kills > 0 && <span className="log-kill"> · kill</span>}
              </span>
            </span>
          ))
        )}
        {dungeonEnc.length > 0 && (
          <span className="muted small log-dungeons" title={dungeonEnc.map((e) => e.name).join(', ')}>
            {raidEnc.length ? '+ ' : ''}
            {dungeonEnc.length} chefe{dungeonEnc.length > 1 ? 's' : ''} de masmorra (M+)
          </span>
        )}
        <span className="muted small log-file">
          {f.name} · {size(f.size)}
          {f.folder && ` · ${f.folder}`}
        </span>
      </span>
      <span className="log-tags">
        {live && <span className="log-tag live">em andamento</span>}
        {analyzed && <span className="log-tag">analisado</span>}
      </span>
    </button>
  );
}
