import { useEffect, useState } from 'react';
import { CircleAlert, Crosshair, ExternalLink, Link2, RotateCw, Unlink, Video } from 'lucide-react';
import type { LogReport, Pull } from '../types';
import { inTauri, migrateWcrDir, openExternal, savedWclLink, saveWclLink, sourceName, wcrCloudVideos, wcrVideos, type LiveStatus, type WcrScan, type WcrVideo } from '../lib/api';
import { reportCode } from '../lib/wcl';
import { logTitle, mainEncounterId } from '../lib/format';
import { BossName } from './Names';
import { matchVideos } from '../lib/wcr';
import { Popover } from './Popover';
import { LiveButton } from './LiveControls';
import { CutoffStepper } from './CutoffStepper';
import { useSetup } from '../lib/setup';

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
  return (
    <header className="topbar">
      <div className="brand">
        <Crosshair size={18} strokeWidth={2} className="brand-mark" aria-hidden />
        Wipe Cause
      </div>

      <LogGroup {...props} />

      <span className="topbar-spacer" />
      {report && (
        <>
          <CutoffStepper
            value={inTauri ? props.deathCutoff : report.deathCutoff}
            disabled={!inTauri || props.busy || !props.canReanalyze}
            title={
              !props.canReanalyze
                ? 'O log original não existe mais: esta análise salva usa o corte com que foi feita.'
                : inTauri
                  ? 'Depois de algumas mortes o wipe já está decidido: nada depois da N-ésima morte conta (dano, cura, erros, falhas, interrupts). 0 = conta tudo. Mudar reanalisa o log.'
                  : 'No navegador o corte vem do JSON (wipe-cli analyze --cutoff N)'
            }
            onChange={props.onCutoff}
          />
          <span className="topbar-divider" aria-hidden />
        </>
      )}
      <div className="topbar-group" aria-label="Desta noite">
        {props.showLive && <LiveButton status={props.live} error={props.liveError} onStart={props.onLiveStart} onStop={props.onLiveStop} />}
        {report && <WclButton logFile={report.file} onWcl={props.onWcl} />}
        {report && inTauri && <VideosButton pulls={report.pulls} onVideos={props.onVideos} />}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Log aberto

function LogGroup({ report, busy, onReanalyze, canReanalyze }: Props) {
  if (!report) return null;

  const fileName = sourceName(report.file);
  const short = report.ignoredShortPulls;
  const meta = [
    `${report.pulls.length} pulls`,
    short > 0 ? `${short} curto${short > 1 ? 's' : ''} ignorado${short > 1 ? 's' : ''}` : null,
    fileName + (report.localLogs?.length ? ` (${report.pulls.length - (report.wclPulls ?? 0)} do log do PC, ${report.wclPulls ?? 0} do WCL)` : ''),
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
          <span className="warn-pill" title="Sem Advanced Combat Logging: HP, recap e bosses ficam incompletos. Ative em Opções → Rede.">
            <CircleAlert size={14} strokeWidth={2} aria-hidden /> Advanced Logging desligado
          </span>
        )}
      </div>
      {inTauri && canReanalyze && (
        <button className="icon-btn" onClick={onReanalyze} disabled={busy} title="Reanalisar o log">
          <RotateCw {...ICON} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warcraft Logs: link do report da noite

function WclButton({ logFile, onWcl }: { logFile: string; onWcl: (code: string | null) => void }) {
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
      label="Link do Warcraft Logs"
      trigger={
        <button className={`btn ghost ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Link2 {...ICON} />
          Warcraft Logs
          <span className={`status-dot ${code ? 'on' : ''}`} aria-label={code ? 'report ligado' : 'sem report'} />
        </button>
      }
    >
      <h4>Report desta noite</h4>
      <p className="muted small">Cada pull ganha um botão que abre o report filtrado no boss, com a try numerada como no WCL.</p>
      <input
        className="text-input"
        autoFocus
        placeholder="https://www.warcraftlogs.com/reports/…"
        value={input}
        onChange={(e) => change(e.target.value)}
      />
      <div className="popover-footer">
        {input ? (
          <span className={`small ${code ? 'muted' : 'bad'}`}>{code ? `report ${code}` : 'Link inválido'}</span>
        ) : (
          <span className="small muted">Nenhum report ligado</span>
        )}
        <span className="topbar-spacer" />
        {input && (
          <button className="btn ghost sm" onClick={() => change('')}>
            <Unlink size={14} strokeWidth={1.5} aria-hidden /> Remover
          </button>
        )}
        {code && (
          <button className="btn sm" onClick={() => openExternal(`https://www.warcraftlogs.com/reports/${code}`)}>
            Abrir <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
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
      onClick={() => openSettings('videos')}
      title={
        scan?.warning ??
        (ok
          ? `${count} de ${pulls.length} pulls com vídeo${cloud ? ` · ${cloud} POV${cloud > 1 ? 's' : ''} da guilda na nuvem` : ''}${scan?.dir ? ` · pasta: ${scan.dir}` : ''}`
          : 'Configurar os vídeos do Warcraft Recorder')
      }
    >
      {scan?.warning ? <CircleAlert {...ICON} className="warn" /> : <Video {...ICON} />}
      Vídeos
      {ok ? (
        <span className="count-badge tabular">
          {count}/{pulls.length}
        </span>
      ) : (
        <span className="small muted">{scan?.warning ? 'verificar' : 'configurar'}</span>
      )}
    </button>
  );
}
