import { useEffect, useState } from 'react';
import { CircleAlert, Crosshair, ExternalLink, Link2, MessageSquare, MessageSquareOff, RotateCw, Unlink, User, Users, Video } from 'lucide-react';
import type { LogReport, Pull } from '../types';
import { discordSetConfig, inTauri, migrateWcrDir, openExternal, savedWclLink, saveWclLink, sourceName, wcrCloudVideos, wcrVideos, type LiveStatus, type WcrScan, type WcrVideo } from '../lib/api';
import { reportCode } from '../lib/wcl';
import { logTitle, mainEncounterId } from '../lib/format';
import { BossName } from './Names';
import { matchVideos } from '../lib/wcr';
import { Popover } from './Popover';
import { LiveButton } from './LiveControls';
import { CutoffStepper } from './CutoffStepper';
import { useSetup } from '../lib/setup';
import { setMode, useMode } from '../lib/mode';
import { useMessages } from '../i18n';
import { headerMsg } from './Header.i18n';

/** Tamanho e traço dos ícones ao lado de texto regular. */
const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

interface Props {
  report: LogReport | null;
  busy: boolean;
  deathCutoff: number;
  /** false quando o log original não existe mais (análise vinda do histórico) */
  canReanalyze: boolean;
  onCutoff: (n: number) => void;
  onReanalyze: () => void;
  onWcl: (code: string | null) => void;
  onVideos: (videos: Map<number, WcrVideo[]>) => void;
  live: LiveStatus;
  /** mostrar o botão "Ao vivo" (só no app; no navegador, com ?demoLive=1) */
  showLive: boolean;
  liveError: string | null;
  onLiveStart: () => void;
  onLiveStop: () => void;
}

/**
 * Topo do app em grupos: marca · log aberto (e ações do arquivo) · análise (corte de mortes)
 * · desta noite (ao vivo, report do Warcraft Logs, vídeos). O setup das integrações fica na
 * página de Configurações.
 */
export function Header(props: Props) {
  const { report } = props;
  const t = useMessages(headerMsg);
  return (
    <header className="topbar">
      <div className="brand">
        <Crosshair size={18} strokeWidth={2} className="brand-mark" aria-hidden />
        Wipe Cause
      </div>
      <ModeSwitch />

      <LogGroup {...props} />

      <span className="topbar-spacer" />
      {report && (
        <>
          <CutoffStepper
            value={inTauri ? props.deathCutoff : report.deathCutoff}
            disabled={!inTauri || props.busy || !props.canReanalyze}
            title={
              !props.canReanalyze
                ? t.cutoffMissingLog
                : inTauri
                  ? t.cutoffHint
                  : t.cutoffBrowser
            }
            onChange={props.onCutoff}
          />
          <span className="topbar-divider" aria-hidden />
        </>
      )}
      <div className="topbar-group" aria-label={t.tonight}>
        {props.showLive && <LiveButton status={props.live} error={props.liveError} onStart={props.onLiveStart} onStop={props.onLiveStop} />}
        {inTauri && <DiscordAutoButton />}
        {report && <WclButton logFile={report.file} onWcl={props.onWcl} />}
        {report && inTauri && <VideosButton pulls={report.pulls} onVideos={props.onVideos} />}
      </div>
    </header>
  );
}

/**
 * Chave geral do envio automático ao Discord (wipes, kills e resumo da noite no ao vivo). Só
 * aparece com o webhook configurado; o que vai em cada caso fica nas Configurações.
 */
function DiscordAutoButton() {
  const { status, reload } = useSetup();
  const t = useMessages(headerMsg);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = status?.discord;
  if (!cfg?.webhook) return null;
  const on = cfg.auto !== false;
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await discordSetConfig({ ...cfg!, auto: !on });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const Icon = on ? MessageSquare : MessageSquareOff;
  return (
    <button
      className={`btn ghost discord-auto ${on ? 'on' : 'off'}`}
      aria-pressed={on}
      aria-label={t.discordAria}
      disabled={busy}
      onClick={toggle}
      title={
        error ??
        (on
          ? t.discordOn
          : t.discordOff)
      }
    >
      <Icon {...ICON} /> <span className="topbar-label">Discord</span> <span className="small live-state">{error ? t.error : on ? t.automatic : t.paused}</span>
    </button>
  );
}

/** Guilda (por que a raid wipou) ou Solo (como você pode melhorar): muda o foco do app inteiro. */
function ModeSwitch() {
  const mode = useMode();
  const t = useMessages(headerMsg);
  return (
    <div className="segmented sm mode-switch" role="radiogroup" aria-label={t.focusAria}>
      <button
        role="radio"
        aria-checked={mode === 'guild'}
        className={mode === 'guild' ? 'active' : ''}
        onClick={() => setMode('guild')}
        title={t.guildTitle}
      >
        <Users size={14} strokeWidth={1.5} aria-hidden /> {t.guild}
      </button>
      <button
        role="radio"
        aria-checked={mode === 'solo'}
        className={mode === 'solo' ? 'active' : ''}
        onClick={() => setMode('solo')}
        title={t.soloTitle}
      >
        <User size={14} strokeWidth={1.5} aria-hidden /> {t.solo}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log aberto

function LogGroup({ report, busy, onReanalyze, canReanalyze }: Props) {
  const t = useMessages(headerMsg);
  if (!report) return null;

  const fileName = sourceName(report.file);
  const short = report.ignoredShortPulls;
  const meta = [
    t.pulls(report.pulls.length),
    short > 0 ? t.shortIgnored(short) : null,
    fileName + (report.localLogs?.length ? t.sources(report.pulls.length - (report.wclPulls ?? 0), report.wclPulls ?? 0) : ''),
  ]
    .filter(Boolean)
    .join(' · ');
  // o chip corta o texto: o tooltip mostra tudo, com o caminho do log
  const full = [`${logTitle(report.pulls)} · ${meta}`, report.file, ...(report.localLogs ?? [])].join('\n');
  return (
    <div className="topbar-group log-group">
      <div className="log-chip" title={full}>
        <div className="log-chip-text">
          <span className="log-title">
            <BossName encounterId={mainEncounterId(report.pulls)} name={logTitle(report.pulls)} size={18} />
          </span>
          <span className="log-meta">{meta}</span>
        </div>
        {!report.advancedLogging && (
          <span className="warn-pill" title={t.advancedOffTitle}>
            <CircleAlert size={14} strokeWidth={2} aria-hidden /> {t.advancedOff}
          </span>
        )}
      </div>
      {inTauri && canReanalyze && (
        <button className="icon-btn" onClick={onReanalyze} disabled={busy} title={t.reanalyze}>
          <RotateCw {...ICON} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warcraft Logs: link do report da noite

function WclButton({ logFile, onWcl }: { logFile: string; onWcl: (code: string | null) => void }) {
  const t = useMessages(headerMsg);
  const [input, setInput] = useState(() => savedWclLink(logFile));
  const [open, setOpen] = useState(false);
  const code = reportCode(input);

  // outro log: recupera o link salvo para ele
  useEffect(() => {
    const saved = savedWclLink(logFile);
    setInput(saved);
    onWcl(reportCode(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFile]);

  function change(value: string) {
    setInput(value);
    saveWclLink(logFile, value);
    onWcl(reportCode(value));
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t.wclPopover}
      trigger={
        <button className={`btn ghost ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Warcraft Logs" title={t.wclTitle}>
          <Link2 {...ICON} />
          <span className="topbar-label">Warcraft Logs</span>
          <span className={`status-dot ${code ? 'on' : ''}`} aria-label={code ? t.reportOn : t.noReport} />
        </button>
      }
    >
      <h4>{t.reportTitle}</h4>
      <p className="muted small">{t.reportHint}</p>
      <input
        className="text-input"
        autoFocus
        placeholder="https://www.warcraftlogs.com/reports/…"
        value={input}
        onChange={(e) => change(e.target.value)}
      />
      <div className="popover-footer">
        {input ? (
          <span className={`small ${code ? 'muted' : 'bad'}`}>{code ? t.report(code) : t.invalidLink}</span>
        ) : (
          <span className="small muted">{t.noReportLinked}</span>
        )}
        <span className="topbar-spacer" />
        {input && (
          <button className="btn ghost sm" onClick={() => change('')}>
            <Unlink size={14} strokeWidth={1.5} aria-hidden /> {t.remove}
          </button>
        )}
        {code && (
          <button className="btn sm" onClick={() => openExternal(`https://www.warcraftlogs.com/reports/${code}`)}>
            {t.open} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Warcraft Recorder: vídeos locais

function VideosButton({ pulls, onVideos }: { pulls: Pull[]; onVideos: (videos: Map<number, WcrVideo[]>) => void }) {
  const { status, openSettings } = useSetup();
  const t = useMessages(headerMsg);
  const [scan, setScan] = useState<WcrScan | null>(null);
  const [count, setCount] = useState(0);
  const [cloud, setCloud] = useState(0);

  // relê quando a pasta ou a conta da nuvem mudam nas Configurações
  useEffect(() => {
    let alive = true;
    Promise.all([migrateWcrDir().then(wcrVideos), wcrCloudVideos().catch(() => [] as WcrVideo[])])
      .then(([s, fromCloud]) => {
        if (!alive) return;
        setScan(s);
        const m = matchVideos(pulls, [...s.videos, ...fromCloud]);
        setCount(m.size);
        setCloud([...m.values()].reduce((n, povs) => n + povs.filter((v) => v.cloud).length, 0));
        onVideos(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulls, status?.wcrDir, status?.wcrCloud?.guild]);

  const ok = (scan?.dir && !scan.warning) || status?.wcrCloud?.configured;
  return (
    <button
      className="btn ghost"
      aria-label={t.videosAria}
      onClick={() => openSettings('videos')}
      title={
        scan?.warning ??
        (ok
          ? t.videosOk(count, pulls.length, cloud, scan?.dir ?? null)
          : t.videosSetup)
      }
    >
      {scan?.warning ? <CircleAlert {...ICON} className="warn" /> : <Video {...ICON} />}
      <span className="topbar-label">{t.videos}</span>
      {ok ? (
        <span className="count-badge tabular">
          {count}/{pulls.length}
        </span>
      ) : (
        <span className="small muted">{scan?.warning ? t.check : t.configure}</span>
      )}
    </button>
  );
}
