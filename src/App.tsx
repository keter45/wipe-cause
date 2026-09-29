import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { LogReport, Pull } from './types';
import {
  analyzeLog,
  historyDelete,
  historyDeleteUnpinned,
  historyList,
  historyLoad,
  historySetPinned,
  discordGetConfig,
  discordPost,
  inTauri,
  pickLogFile,
  rememberFile,
  sameLog,
  type HistoryEntry,
} from './lib/api';
import { BossSummary, NightOverview } from './components/NightSummary';
import { LogBrowser } from './components/LogBrowser';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdater, type UpdateState } from './lib/updater';
import { useLive } from './lib/live';
import { pullPayload } from './lib/discord';
import { LiveToast } from './components/LiveToast';
import { TrendsView } from './components/TrendsView';
import { NIGHT } from './components/PullList';
import { bossKey } from './lib/night';
import { savedDeathCutoff, saveDeathCutoff } from './lib/cutoff';
import { PullView } from './components/PullView';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import type { WcrScan, WcrVideo } from './lib/api';
import { matchVideos } from './lib/wcr';

type Status = { kind: 'idle' } | { kind: 'loading'; progress: number; path: string } | { kind: 'error'; message: string };

/** Analisar e escolher arquivos/pastas só funciona no app (o navegador é só para desenvolver a UI). */
const NEEDS_APP = 'No navegador não dá para ler os logs: abra o app (npm run tauri dev) ou carregue um relatório JSON pela barra lateral.';

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
  // NIGHT = visão geral; chave de boss = resumo do boss; null = pull selecionado
  const [summary, setSummary] = useState<string | null>(NIGHT);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // lista de logs da pasta do WoW ("Nova análise"); sem relatório aberto ela é a tela inicial
  const [browsing, setBrowsing] = useState(false);
  // tela de evolução entre noites (histórico)
  const [trends, setTrends] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoTrends'));
  const [sidebarOpen, setSidebarOpen] = useState(savedSidebarOpen);
  // corte da análise na tela; a preferência (para logs novos) fica salva à parte
  const [deathCutoff, setDeathCutoff] = useState(savedDeathCutoff);
  const cutoffTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [wclCode, setWclCode] = useState<string | null>(null);
  const [videos, setVideos] = useState<Map<number, WcrVideo>>(new Map());
  const updater = useUpdater();
  // pull que acabou de ser analisado no modo ao vivo (aviso no canto)
  const [liveToast, setLiveToast] = useState<{ pull: Pull; discord: string | null } | null>(null);
  const live = useLive(onLiveReport);
  // dev no navegador: ?demoLive=1 mostra o botão e o aviso do modo ao vivo (só visual)
  useEffect(() => {
    if (demoLive && report && !liveToast) setLiveToast({ pull: report.pulls[report.pulls.length - 1], discord: 'enviado ao Discord' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  /** Nova análise do modo ao vivo: atualiza a tela e, se o usuário acompanha o último pull, abre o novo. */
  function onLiveReport(r: LogReport, fresh: Pull[]) {
    const sameFile = report != null && sameLog(report.file, r.file);
    const lastId = report?.pulls[report.pulls.length - 1]?.id;
    const following = !sameFile || summary === NIGHT || browsing || selected === lastId;
    if (sameFile) setReport(r);
    else showReport(r);
    setStatus({ kind: 'idle' });
    refreshHistory();
    const newest = fresh[fresh.length - 1];
    if (!newest) return;
    if (following) {
      setSelected(newest.id);
      setSummary(null);
      setBrowsing(false);
    }
    setLiveToast({ pull: newest, discord: null });
    postToDiscord(fresh);
  }

  /** Envia os pulls novos para o Discord, conforme a configuração (wipes e/ou kills). */
  async function postToDiscord(fresh: Pull[]) {
    const cfg = await discordGetConfig().catch(() => null);
    if (!cfg?.webhook) return;
    for (const p of fresh) {
      if (p.success ? !cfg.onKill : !cfg.onWipe) continue;
      try {
        await discordPost(pullPayload(p, wclCode));
        setLiveToast((t) => (t && t.pull.startMs === p.startMs ? { ...t, discord: 'enviado ao Discord' } : t));
      } catch (e) {
        setLiveToast((t) => (t && t.pull.startMs === p.startMs ? { ...t, discord: `Discord: ${e}` } : t));
      }
    }
  }
  // dev no navegador: ?demoUpdate=1 mostra o aviso de versão nova (só visual)
  const updateState: UpdateState = demoUpdate ? { kind: 'available', version: '0.4.0', notes: '- Exemplo de novidade\n- Outra novidade' } : updater.state;

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
    if (!inTauri) {
      setStatus({ kind: 'error', message: NEEDS_APP });
      return;
    }
    setStatus({ kind: 'loading', progress: 0, path });
    try {
      const r = await analyzeLog(path, cutoff, (progress) => setStatus({ kind: 'loading', progress, path }));
      rememberFile(path);
      if (keepView) setReport(r);
      else showReport(r);
      setBrowsing(false);
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
    setSummary(NIGHT); // abre no resumo da noite
  }

  /** Log novo: usa o corte salvo como preferência. */
  async function analyzePath(path: string) {
    const pref = savedDeathCutoff();
    setDeathCutoff(pref);
    await load(path, false, pref);
  }

  async function openFile() {
    if (!inTauri) {
      setStatus({ kind: 'error', message: NEEDS_APP });
      return;
    }
    const path = await pickLogFile();
    if (path) await analyzePath(path);
  }

  /** Mudou o N: salva como preferência e reanalisa o log aberto (o corte é feito no núcleo). */
  function changeCutoff(n: number) {
    setDeathCutoff(n);
    saveDeathCutoff(n);
    window.clearTimeout(cutoffTimer.current);
    // ao vivo: reinicia o acompanhamento com o corte novo (ele já reanalisa o log)
    if (inTauri && live.status.active) cutoffTimer.current = window.setTimeout(() => live.start(n), 600);
    else if (inTauri && report) cutoffTimer.current = window.setTimeout(() => load(report.file, true, n), 600);
  }

  async function openEntry(e: HistoryEntry) {
    setBrowsing(false);
    setTrends(false);
    if (report && sameLog(e.logPath, report.file)) {
      setSummary(NIGHT);
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
    setTrends(false);
    setSelected(id);
    setSummary(null);
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
        live={demoLive ? { active: true, state: 'in_combat', file: 'WoWCombatLog-092826_204129.txt', encounter: 'The Coiled Altar', analyzed: 3, message: null } : live.status}
        showLive={inTauri || demoLive}
        liveError={live.error}
        onLiveStart={() => live.start(deathCutoff)}
        onLiveStop={live.stop}
      />

      {status.kind === 'loading' && (
        <div className="progress">
          <div className="progress-bar" style={{ transform: `scaleX(${status.progress})` }} />
          <span>Analisando {status.path.split(/[\\/]/).pop()}… {Math.round(status.progress * 100)}%</span>
        </div>
      )}
      <UpdateBanner state={updateState} onInstall={updater.install} onDismiss={updater.dismiss} />
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
            onNew={() => {
              setTrends(false);
              setBrowsing(true);
            }}
            browsing={!trends && (browsing || !report)}
            trendsActive={trends}
            onTrends={() => setTrends(true)}
            appVersion={updater.version}
            updateState={updateState}
            onCheckUpdates={() => updater.checkNow(true)}
            onOpenJson={showReport}
            onOpenEntry={openEntry}
            onTogglePin={togglePin}
            onDelete={deleteEntry}
            onDeleteUnpinned={deleteUnpinned}
            pulls={pulls}
            selected={selected}
            onSelect={selectPull}
            summary={summary}
            onSummary={(k) => {
              setTrends(false);
              setBrowsing(false);
              setSummary(k);
            }}
          />
        )}
        <main className="content">
          {trends ? (
            <TrendsView />
          ) : !report || browsing ? (
            inTauri || demoLogs ? (
              <>
                {!report && <Intro />}
                <LogBrowser history={history} busy={status.kind === 'loading'} onAnalyze={analyzePath} onOpenFile={openFile} />
              </>
            ) : (
              <Empty hasHistory={history.length > 0} />
            )
          ) : summary === NIGHT ? (
            <NightOverview pulls={pulls} onSelectPull={selectPull} onSelectBoss={setSummary} />
          ) : summary != null ? (
            <BossSummary key={summary} title={summary} pulls={pulls.filter((p) => bossKey(p) === summary)} onSelectPull={selectPull} />
          ) : pull ? (
            <PullView pull={pull} wclCode={wclCode ?? undefined} video={videos.get(pull.id)} />
          ) : (
            <p className="muted">Nenhum pull no log.</p>
          )}
          {liveToast && (
            <LiveToast
              pull={liveToast.pull}
              discord={liveToast.discord}
              onOpen={() => {
                const p = report?.pulls.find((x) => x.startMs === liveToast.pull.startMs);
                if (p) selectPull(p.id);
                setLiveToast(null);
              }}
              onClose={() => setLiveToast(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** Dev no navegador: `?demoLogs=1` mostra a lista de logs de exemplo. */
const demoLive = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoLive');
const demoUpdate = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoUpdate');
const demoLogs = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoLogs');

/** Tela inicial do app, acima da lista de logs. */
function Intro() {
  return (
    <div className="intro">
      <Crosshair size={32} strokeWidth={1.5} className="empty-mark" aria-hidden />
      <div>
        <h1>Por que deu wipe?</h1>
        <p className="muted">
          Escolha o log da raid e veja o gatilho de cada wipe, as mortes e quem errou o quê. No jogo, use <code>/combatlog</code> antes do pull,
          com <em>Advanced Combat Logging</em> ligado (Opções → Rede).
        </p>
      </div>
    </div>
  );
}

function Empty({ hasHistory }: { hasHistory: boolean }) {
  return (
    <div className="empty">
      <Crosshair size={40} strokeWidth={1.5} className="empty-mark" aria-hidden />
      <h1>Por que deu wipe?</h1>
      <p className="muted small">
        Modo navegador: gere o relatório com <code>wipe-cli analyze log.txt --json</code> e abra o JSON pela barra lateral.
      </p>
      {hasHistory && <p className="muted small">Ou abra uma análise salva na barra lateral.</p>}
    </div>
  );
}
