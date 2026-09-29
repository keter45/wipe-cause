import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, FolderOpen } from 'lucide-react';
import type { LogReport } from './types';
import {
  analyzeLog,
  historyDelete,
  historyDeleteUnpinned,
  historyList,
  historyLoad,
  historySetPinned,
  inTauri,
  pickLogFile,
  rememberFile,
  sameLog,
  type HistoryEntry,
} from './lib/api';
import { NightSummary } from './components/NightSummary';
import { savedDeathCutoff, saveDeathCutoff } from './lib/cutoff';
import { PullView } from './components/PullView';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import type { WcrScan, WcrVideo } from './lib/api';
import { matchVideos } from './lib/wcr';

type Status = { kind: 'idle' } | { kind: 'loading'; progress: number; path: string } | { kind: 'error'; message: string };

const SIDEBAR_KEY = 'wipe-cause:sidebar-open';
function savedSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

export default function App() {
  const [report, setReport] = useState<LogReport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showSummary, setShowSummary] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(savedSidebarOpen);
  // corte da análise na tela; a preferência (para logs novos) fica salva à parte
  const [deathCutoff, setDeathCutoff] = useState(savedDeathCutoff);
  const cutoffTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [wclCode, setWclCode] = useState<string | null>(null);
  const [videos, setVideos] = useState<Map<number, WcrVideo>>(new Map());

  const refreshHistory = () => historyList().then(setHistory).catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);

  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* sem storage */
    }
  }

  // Dev no navegador: ?report=/samples/report.json carrega um relatório gerado pelo wipe-cli;
  // &videos=/samples/wcr-scan.json casa vídeos do Warcraft Recorder (arquivos servidos pelo vite).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('report');
    if (import.meta.env.DEV && !inTauri && url) {
      fetch(url)
        .then((r) => r.json())
        .then(async (r: LogReport) => {
          showReport(r);
          const scan = params.get('videos');
          if (scan) {
            const s = (await fetch(scan).then((x) => x.json())) as WcrScan;
            setVideos(matchVideos(r.pulls, s.videos));
          }
        })
        .catch((e) => setStatus({ kind: 'error', message: String(e) }));
    }
  }, []);

  async function load(path: string, keepView = false, cutoff = deathCutoff) {
    setStatus({ kind: 'loading', progress: 0, path });
    try {
      const r = await analyzeLog(path, cutoff, (progress) => setStatus({ kind: 'loading', progress, path }));
      rememberFile(path);
      if (keepView) setReport(r);
      else showReport(r);
      setStatus({ kind: 'idle' });
      refreshHistory(); // o backend salvou no histórico
    } catch (e) {
      setStatus({ kind: 'error', message: String(e) });
    }
  }

  function showReport(r: LogReport) {
    setReport(r);
    setDeathCutoff(r.deathCutoff);
    // abre no último wipe (normalmente o que a raid quer ver)
    const lastWipe = [...r.pulls].reverse().find((p) => !p.success) ?? r.pulls[r.pulls.length - 1];
    setSelected(lastWipe?.id ?? null);
    setShowSummary(true); // abre no resumo da noite
  }

  async function openFile() {
    const path = await pickLogFile();
    if (!path) return;
    const pref = savedDeathCutoff();
    setDeathCutoff(pref);
    await load(path, false, pref);
  }

  /** Mudou o N: salva como preferência e reanalisa o log aberto (o corte é feito no núcleo). */
  function changeCutoff(n: number) {
    setDeathCutoff(n);
    saveDeathCutoff(n);
    window.clearTimeout(cutoffTimer.current);
    if (inTauri && report) cutoffTimer.current = window.setTimeout(() => load(report.file, true, n), 600);
  }

  async function openEntry(e: HistoryEntry) {
    if (report && sameLog(e.logPath, report.file)) {
      setShowSummary(true);
      return;
    }
    if (!inTauri) return; // navegador: o histórico de exemplo é só visual
    try {
      showReport(await historyLoad(e.id));
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  }

  async function togglePin(e: HistoryEntry) {
    await historySetPinned(e.id, !e.pinned);
    setHistory((h) => h.map((x) => (x.id === e.id ? { ...x, pinned: !e.pinned } : x)));
    refreshHistory();
  }

  async function deleteEntry(e: HistoryEntry) {
    await historyDelete(e.id);
    setHistory((h) => h.filter((x) => x.id !== e.id));
  }

  async function deleteUnpinned() {
    await historyDeleteUnpinned();
    setHistory((h) => h.filter((x) => x.pinned));
  }

  const selectPull = (id: number) => {
    setSelected(id);
    setShowSummary(false);
  };
  const pulls = report?.pulls ?? [];
  const pull = useMemo(() => report?.pulls.find((p) => p.id === selected) ?? null, [report, selected]);
  const entry = report ? history.find((e) => sameLog(e.logPath, report.file)) : undefined;
  // análise do histórico cujo log sumiu: dá para ver, mas não para reanalisar
  const logMissing = entry != null && !entry.logExists;

  return (
    <div className="app">
      <Header
        report={report}
        busy={status.kind === 'loading'}
        deathCutoff={deathCutoff}
        canReanalyze={!logMissing}
        onCutoff={changeCutoff}
        onReanalyze={() => report && load(report.file, true)}
        onWcl={setWclCode}
        onVideos={setVideos}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      {status.kind === 'loading' && (
        <div className="progress">
          <div className="progress-bar" style={{ transform: `scaleX(${status.progress})` }} />
          <span>Analisando {status.path.split(/[\\/]/).pop()}… {Math.round(status.progress * 100)}%</span>
        </div>
      )}
      {status.kind === 'error' && <div className="error">Erro: {status.message}</div>}
      {report && report.ruleErrors?.length > 0 && (
        <div className="error">Regras de boss com erro: {report.ruleErrors.join('; ')}</div>
      )}

      <div className="layout">
        {sidebarOpen && (
          <Sidebar
            history={history}
            report={report}
            busy={status.kind === 'loading'}
            onNew={openFile}
            onOpenJson={showReport}
            onOpenEntry={openEntry}
            onTogglePin={togglePin}
            onDelete={deleteEntry}
            onDeleteUnpinned={deleteUnpinned}
            pulls={pulls}
            selected={selected}
            onSelect={selectPull}
            summaryActive={showSummary}
            onSummary={() => setShowSummary(true)}
          />
        )}
        <main className="content">
          {!report ? (
            <Empty onOpen={openFile} hasHistory={history.length > 0} />
          ) : showSummary ? (
            <NightSummary pulls={pulls} onSelectPull={selectPull} />
          ) : pull ? (
            <PullView pull={pull} wclCode={wclCode ?? undefined} video={videos.get(pull.id)} />
          ) : (
            <p className="muted">Nenhum pull no log.</p>
          )}
        </main>
      </div>
    </div>
  );
}

function Empty({ onOpen, hasHistory }: { onOpen: () => void; hasHistory: boolean }) {
  return (
    <div className="empty">
      <Crosshair size={40} strokeWidth={1.5} className="empty-mark" aria-hidden />
      <h1>Por que deu wipe?</h1>
      <p className="muted">Abra o combat log da raid e veja o gatilho de cada wipe, as mortes e quem errou o quê.</p>
      <ol className="empty-steps">
        <li>
          <span>
            No jogo, digite <code>/combatlog</code> antes do pull e ative <em>Advanced Combat Logging</em> em Opções → Rede.
          </span>
        </li>
        <li>
          <span>
            Depois das trys, abra o <code>WoWCombatLog-*.txt</code> em <code>World of Warcraft\_retail_\Logs</code>.
          </span>
        </li>
        <li>
          <span>Opcional: cole o link do report do Warcraft Logs e ligue a pasta de vídeos do Warcraft Recorder.</span>
        </li>
      </ol>
      {inTauri ? (
        <div className="empty-actions">
          <button className="btn primary" onClick={onOpen}>
            <FolderOpen size={16} strokeWidth={2} aria-hidden /> Abrir combat log
          </button>
        </div>
      ) : (
        <p className="muted small">
          Modo navegador: gere o relatório com <code>wipe-cli analyze log.txt --json</code> e abra o JSON pela barra lateral.
        </p>
      )}
      {hasHistory && <p className="muted small">Ou abra uma análise salva na barra lateral.</p>}
    </div>
  );
}
