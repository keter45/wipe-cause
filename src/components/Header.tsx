import { useEffect, useState } from 'react';
import { CircleAlert, Crosshair, ExternalLink, FileText, FolderOpen, Link2, Minus, PanelLeftClose, PanelLeftOpen, Plus, RotateCw, Skull, Unlink, Video } from 'lucide-react';
import type { LogReport, Pull } from '../types';
import {
  inTauri,
  migrateWcrDir,
  openExternal,
  pickFolder,
  savedWclLink,
  saveWclLink,
  wcrDetectDir,
  wcrGetDir,
  wcrSetDir,
  wcrVideos,
  type WcrScan,
  type WcrVideo,
} from '../lib/api';
import { reportCode } from '../lib/wcl';
import { logTitle } from '../lib/format';
import { matchVideos } from '../lib/wcr';
import { Popover } from './Popover';

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
  onVideos: (videos: Map<number, WcrVideo>) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/**
 * Topo do app em grupos: marca · log aberto (e ações do arquivo) · análise (corte de mortes)
 * · integrações (Warcraft Logs, vídeos).
 */
export function Header(props: Props) {
  const { report } = props;
  return (
    <header className="topbar">
      <button
        className="icon-btn"
        onClick={props.onToggleSidebar}
        title={props.sidebarOpen ? 'Recolher barra lateral' : 'Mostrar barra lateral'}
        aria-label={props.sidebarOpen ? 'Recolher barra lateral' : 'Mostrar barra lateral'}
        aria-expanded={props.sidebarOpen}
      >
        {props.sidebarOpen ? <PanelLeftClose {...ICON} /> : <PanelLeftOpen {...ICON} />}
      </button>
      <div className="brand">
        <Crosshair size={18} strokeWidth={2} className="brand-mark" aria-hidden />
        Wipe Cause
      </div>

      <LogGroup {...props} />

      {report && (
        <>
          <span className="topbar-spacer" />
          <CutoffStepper
            value={inTauri ? props.deathCutoff : report.deathCutoff}
            disabled={!inTauri || props.busy || !props.canReanalyze}
            missingLog={!props.canReanalyze}
            onChange={props.onCutoff}
          />
          <span className="topbar-divider" aria-hidden />
          <div className="topbar-group" aria-label="Integrações">
            <WclButton logFile={report.file} onWcl={props.onWcl} />
            {inTauri && <VideosButton pulls={report.pulls} onVideos={props.onVideos} />}
          </div>
        </>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Log aberto

function LogGroup({ report, busy, onReanalyze, canReanalyze }: Props) {
  if (!report) return null;

  const fileName = report.file.split(/[\\/]/).pop();
  return (
    <div className="topbar-group log-group">
      <div className="log-chip" title={report.file}>
        <FileText {...ICON} className="muted" />
        <div className="log-chip-text">
          <span className="log-title">{logTitle(report.pulls)}</span>
          <span className="log-meta">
            {report.pulls.length} pulls
            {report.ignoredShortPulls > 0 && ` · ${report.ignoredShortPulls} curto${report.ignoredShortPulls > 1 ? 's' : ''} ignorado${report.ignoredShortPulls > 1 ? 's' : ''}`}
            {' · '}
            {fileName}
          </span>
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
// Análise: ignorar eventos após N mortes

function CutoffStepper({ value, disabled, missingLog, onChange }: { value: number; disabled: boolean; missingLog: boolean; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Math.min(40, n)));
  return (
    <div
      className="stepper"
      role="group"
      aria-label="Ignorar eventos após N mortes"
      title={
        missingLog
          ? 'O log original não existe mais: esta análise salva usa o corte com que foi feita.'
          : inTauri
          ? 'Depois de algumas mortes o wipe já está decidido: nada depois da N-ésima morte conta (dano, cura, erros, falhas, interrupts). 0 = conta tudo. Mudar reanalisa o log.'
          : 'No navegador o corte vem do JSON (wipe-cli analyze --cutoff N)'
      }
    >
      <Skull {...ICON} className="muted" />
      <span className="stepper-label">Ignorar após</span>
      <button className="icon-btn sm" onClick={() => set(value - 1)} disabled={disabled || value <= 0} aria-label="Menos uma morte">
        <Minus size={14} strokeWidth={2} aria-hidden />
      </button>
      <input
        className="stepper-value"
        type="number"
        min={0}
        max={40}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value) || 0)}
        aria-label="Número de mortes"
      />
      <button className="icon-btn sm" onClick={() => set(value + 1)} disabled={disabled || value >= 40} aria-label="Mais uma morte">
        <Plus size={14} strokeWidth={2} aria-hidden />
      </button>
      <span className="stepper-label">{value === 0 ? 'mortes (desligado)' : value === 1 ? 'morte' : 'mortes'}</span>
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

function VideosButton({ pulls, onVideos }: { pulls: Pull[]; onVideos: (videos: Map<number, WcrVideo>) => void }) {
  const [scan, setScan] = useState<WcrScan | null>(null);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    const s = await wcrVideos();
    setScan(s);
    const m = matchVideos(pulls, s.videos);
    setCount(m.size);
    onVideos(m);
  }

  useEffect(() => {
    migrateWcrDir().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulls]);

  const ok = scan?.dir && !scan.warning;
  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} title={scan?.warning ?? scan?.dir ?? 'Escolher a pasta de vídeos do Warcraft Recorder'}>
        {scan?.warning ? <CircleAlert {...ICON} className="warn" /> : <Video {...ICON} />}
        Vídeos
        {ok ? <span className="count-badge">{count}/{pulls.length}</span> : <span className="small muted">{scan?.warning ? 'verificar' : 'configurar'}</span>}
      </button>
      {open && <VideoFolderDialog scan={scan} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  );
}

/** Cadastro da pasta onde o Warcraft Recorder salva os vídeos (varia de PC para PC). */
function VideoFolderDialog({ scan, onClose, onChanged }: { scan: WcrScan | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    wcrGetDir().then((d) => {
      setSaved(d);
      setPath(d ?? '');
    });
    wcrDetectDir().then(setDetected);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(dir: string | null) {
    await wcrSetDir(dir);
    setSaved(dir && dir.trim() ? dir.trim() : null);
    await onChanged();
  }

  async function browse() {
    const dir = await pickFolder('Pasta de vídeos do Warcraft Recorder');
    if (dir) {
      setPath(dir);
      await save(dir);
    }
  }

  const using = saved ? 'cadastrada aqui' : scan?.source === 'recorder' ? 'detectada no Warcraft Recorder' : null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Pasta de vídeos do Warcraft Recorder" onClick={(e) => e.stopPropagation()}>
        <h3>Pasta de vídeos do Warcraft Recorder</h3>
        <p className="small muted">
          Onde o Warcraft Recorder salva os vídeos neste PC (Settings → General → Storage Path no Recorder). O app lê os .mp4 e
          .json dessa pasta e casa cada vídeo com o pull.
        </p>

        <label className="field">
          Caminho da pasta
          <input
            className="text-input"
            value={path}
            placeholder={detected ?? 'D:\\WarcraftRecorder'}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save(path)}
          />
        </label>
        <div className="dialog-actions left">
          <button className="btn" onClick={browse}>
            <FolderOpen {...ICON} /> Procurar…
          </button>
          <button className="btn primary" onClick={() => save(path)} disabled={!path.trim() || path.trim() === saved}>
            Salvar
          </button>
          {detected && (
            <button
              className="btn ghost"
              onClick={() => {
                setPath('');
                save(null);
              }}
              disabled={!saved}
              title={detected}
            >
              Usar a do Warcraft Recorder
            </button>
          )}
        </div>

        <div className="folder-status small">
          {scan?.dir ? (
            <>
              <div>
                Usando <code>{scan.dir}</code> {using && <span className="muted">({using})</span>}
              </div>
              {scan.warning ? (
                <div className="bad">{scan.warning}</div>
              ) : (
                <div className="ok-text">{scan.videos.length} vídeos de encontros encontrados</div>
              )}
            </>
          ) : (
            <div className="muted">Nenhuma pasta cadastrada{detected ? '' : ' e o Warcraft Recorder não foi encontrado neste PC'}.</div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
