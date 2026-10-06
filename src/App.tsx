import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Crosshair, Settings } from 'lucide-react';
import type { LogReport, Pull } from './types';
import {
  analyzeLog,
  historyDelete,
  historyDeleteUnpinned,
  historyList,
  historyLoad,
  historySetPinned,
  discordGetConfig,
  inTauri,
  pickLogFile,
  rememberFile,
  sameLog,
  sourceName,
  setBackendLocale,
  type HistoryEntry,
} from './lib/api';
import { BossSummary, NightOverview } from './components/NightSummary';
import { LogBrowser } from './components/LogBrowser';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdater, type UpdateState } from './lib/updater';
import { listen } from '@tauri-apps/api/event';
import { useLive } from './lib/live';
import { savedGuildId } from './lib/guildNights';
import { useAutoLive } from './lib/autoLive';
import { postPullImage, useNightRecap } from './lib/discordLive';
import { LiveToast } from './components/LiveToast';
import { TrendsView } from './components/TrendsView';
import { NIGHT } from './components/PullList';
import { bossKey } from './lib/night';
import { savedDeathCutoff, saveDeathCutoff } from './lib/cutoff';
import { PullView } from './components/PullView';
import { SoloBossView, SoloNightView, SoloTrendsView } from './components/SoloNight';
import { useMode } from './lib/mode';
import { Header } from './components/Header';
import { Sidebar, SidebarRail } from './components/Sidebar';
import type { WcrScan, WcrVideo } from './lib/api';
import { matchVideos } from './lib/wcr';
import { raidOnly } from './lib/content';
import { PlayerClassesContext, playerClasses } from './lib/players';
import { SettingsView } from './components/settings/SettingsView';
import { messagesOf, useLocale, useMessages } from './i18n';
import { appMsg } from './App.i18n';
import { SetupContext, optionalDone, useSetup, useSetupStatus, type SettingsSection } from './lib/setup';

/** O que ocupa a área principal: a análise aberta, a lista de logs, a evolução ou as configurações. */
type Page = 'analysis' | 'browse' | 'trends' | 'settings';

type Status = { kind: 'idle' } | { kind: 'loading'; progress: number; path: string } | { kind: 'error'; message: string };

/** Analisar e escolher arquivos/pastas só funciona no app (o navegador é só para desenvolver a UI). */
const needsApp = () => messagesOf(appMsg).needsApp;

const SIDEBAR_KEY = 'wipe-cause:sidebar-open';
function savedSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

const ONBOARDED_KEY = 'wipe-cause:onboarded';
function onboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return true;
  }
}
function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* sem storage */
  }
}

export default function App() {
  // trocar o idioma remonta as telas (textos montados em memória saem de novo), sem perder o log aberto
  const locale = useLocale();
  useEffect(() => {
    void setBackendLocale(locale);
  }, [locale]);
  const [report, setReport] = useState<LogReport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // NIGHT = visão geral; chave de boss = resumo do boss; null = pull selecionado
  const [summary, setSummary] = useState<string | null>(NIGHT);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // sem relatório aberto, 'analysis' mostra a lista de logs (tela inicial)
  const [page, setPage] = useState<Page>(() => (demoTrends ? 'trends' : demoSettings ? 'settings' : 'analysis'));
  const [settingsFocus, setSettingsFocus] = useState<{ section: SettingsSection; n: number } | null>(null);
  const setup = useSetupStatus();
  const openSettings = (section?: SettingsSection) => {
    setPage('settings');
    if (section) setSettingsFocus((f) => ({ section, n: (f?.n ?? 0) + 1 }));
  };
  const [sidebarOpen, setSidebarOpen] = useState(savedSidebarOpen);
  // corte da análise na tela; a preferência (para logs novos) fica salva à parte
  const [deathCutoff, setDeathCutoff] = useState(savedDeathCutoff);
  const cutoffTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [wclCode, setWclCode] = useState<string | null>(null);
  const [videos, setVideos] = useState<Map<number, WcrVideo[]>>(new Map());
  const updater = useUpdater();
  // pull que acabou de ser analisado no modo ao vivo (aviso no canto)
  const [liveToast, setLiveToast] = useState<{ pull: Pull; discord: string | null } | null>(null);
  // guilda do login do Warcraft Logs: ao vivo sem log neste PC segue o report ao vivo dela
  const wclGuild = useMemo(() => {
    const guilds = setup.status?.wcl?.user?.guilds ?? [];
    return guilds.find((g) => g.id === savedGuildId()) ?? guilds[0] ?? null;
  }, [setup.status]);
  const live = useLive(onLiveReport, wclGuild);
  useAutoLive(wclGuild, live.status.active, () => live.start(deathCutoff));
  // "ao vivo quando o WoW abrir": o backend avisa (o app pode estar só na bandeja)
  const liveRef = useRef({ active: live.status.active, start: live.start, cutoff: deathCutoff });
  liveRef.current = { active: live.status.active, start: live.start, cutoff: deathCutoff };
  useEffect(() => {
    if (!inTauri) return;
    const off = listen('wow-started', () => {
      const l = liveRef.current;
      if (!l.active) void l.start(l.cutoff, { local: true });
    });
    return () => {
      off.then((f) => f());
    };
  }, []);
  // resumo da noite no Discord quando a raid acaba (ao vivo desligado ou 30 min sem pull)
  const trackNight = useNightRecap(live.status.active);
  // dev no navegador: ?demoLive=1 mostra o botão e o aviso do modo ao vivo (só visual)
  useEffect(() => {
    if (demoLive && report && !liveToast) setLiveToast({ pull: report.pulls[report.pulls.length - 1], discord: messagesOf(appMsg).sentToDiscord });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  /** Nova análise do modo ao vivo: atualiza a tela e, se o usuário acompanha o último pull, abre o novo. */
  function onLiveReport(r: LogReport, fresh: Pull[]) {
    const sameFile = report != null && sameLog(report.file, r.file);
    const lastId = report?.pulls[report.pulls.length - 1]?.id;
    const following = page !== 'settings' && (!sameFile || summary === NIGHT || page === 'browse' || selected === lastId);
    if (sameFile) setReport(r);
    else showReport(r);
    setStatus({ kind: 'idle' });
    refreshHistory();
    // o app é para raid: pulls de masmorra (M+) entram na lista, mas não abrem nem avisam
    const freshRaid = raidOnly(fresh);
    const newest = freshRaid[freshRaid.length - 1];
    if (!newest) return;
    if (following) {
      setSelected(newest.id);
      setSummary(null);
      setPage('analysis');
    }
    setLiveToast({ pull: newest, discord: null });
    trackNight(r.pulls);
    postToDiscord(freshRaid, r.pulls);
  }

  /** Envia os pulls novos para o Discord, conforme a configuração (wipes e/ou kills). */
  /** Pulls novos no Discord, como imagem: wipe = motivo do wipe; kill = resumo do boss. */
  async function postToDiscord(fresh: Pull[], all: Pull[]) {
    const cfg = await discordGetConfig().catch(() => null);
    if (!cfg?.webhook || cfg.auto === false) return;
    for (const p of fresh) {
      if (p.success ? !cfg.onKill : !cfg.onWipe) continue;
      try {
        await postPullImage(p, all);
        setLiveToast((t) => (t && t.pull.startMs === p.startMs ? { ...t, discord: messagesOf(appMsg).sentToDiscord } : t));
      } catch (e) {
        setLiveToast((t) => (t && t.pull.startMs === p.startMs ? { ...t, discord: `Discord: ${e}` } : t));
      }
    }
  }
  // dev no navegador: ?demoUpdate=1 mostra o aviso de versão nova (só visual)
  const updateState: UpdateState = demoUpdate ? { kind: 'available', version: '0.4.0', notes: messagesOf(appMsg).demoNotes } : updater.state;

  const refreshHistory = () => historyList().then(setHistory).catch(() => {});
  // primeira vez no app (sem nenhuma análise): abre nas Configurações, com o passo a passo
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    historyList()
      .then((h) => {
        setHistory(h);
        if (!onboarded()) {
          markOnboarded();
          if (h.length === 0 && inTauri) {
            setFirstRun(true);
            setPage('settings');
          }
        }
      })
      .catch(() => {});
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
      setStatus({ kind: 'error', message: needsApp() });
      return;
    }
    setStatus({ kind: 'loading', progress: 0, path });
    try {
      const r = await analyzeLog(path, cutoff, (progress) => setStatus({ kind: 'loading', progress, path }));
      rememberFile(path);
      // noite completada com o Warcraft Logs: a análise só do log do PC fica redundante no histórico
      for (const e of history.filter((h) => r.localLogs?.some((l) => sameLog(h.logPath, l)))) await historyDelete(e.id).catch(() => {});
      if (keepView) setReport(r);
      else showReport(r);
      setPage('analysis');
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
    const raid = raidOnly(r.pulls);
    const pool = raid.length ? raid : r.pulls;
    const lastWipe = [...pool].reverse().find((p) => !p.success) ?? pool[pool.length - 1];
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
      setStatus({ kind: 'error', message: needsApp() });
      return;
    }
    const path = await pickLogFile();
    if (path) await analyzePath(path);
  }

  /** Regras do boss ajustadas: reanalisa o log aberto (ao vivo, reinicia o acompanhamento). */
  function rulesChanged() {
    if (inTauri && live.status.active) live.start(deathCutoff);
    else if (inTauri && report) void load(report.file, true, deathCutoff);
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
    setPage('analysis');
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
    setPage('analysis');
    setSelected(id);
    setSummary(null);
  };
  const pulls = report?.pulls ?? [];
  const pull = useMemo(() => report?.pulls.find((p) => p.id === selected) ?? null, [report, selected]);
  const entry = report ? history.find((e) => sameLog(e.logPath, report.file)) : undefined;
  // análise do histórico cujo log sumiu: dá para ver, mas não para reanalisar
  const logMissing = entry != null && !entry.logExists;

  const browsing = page === 'browse' || (page === 'analysis' && !report);
  const solo = useMode() === 'solo';
  const classes = useMemo(() => playerClasses(report?.pulls ?? []), [report]);
  return (
    <SetupContext.Provider value={{ status: setup.status, reload: setup.reload, openSettings }}>
    <PlayerClassesContext.Provider value={classes}>
    <div className="app" key={locale}>
      <Header
        report={report}
        busy={status.kind === 'loading'}
        deathCutoff={deathCutoff}
        canReanalyze={!logMissing}
        onCutoff={changeCutoff}
        onReanalyze={() => report && load(report.file, true)}
        onWcl={setWclCode}
        onVideos={setVideos}
        live={demoLive ? { active: true, state: 'in_combat', file: 'WoWCombatLog-092826_204129.txt', encounter: 'The Coiled Altar', analyzed: 3, message: null } : live.status}
        showLive={inTauri || demoLive}
        liveError={live.error}
        onLiveStart={() => live.start(deathCutoff)}
        onLiveStop={live.stop}
      />

      {status.kind === 'loading' && (
        <div className="progress">
          <div className="progress-bar" style={{ transform: `scaleX(${status.progress})` }} />
          <span>Analisando {sourceName(status.path)}… {Math.round(status.progress * 100)}%</span>
        </div>
      )}
      <UpdateBanner state={updateState} onInstall={updater.install} onDismiss={updater.dismiss} />
      {status.kind === 'error' && <div className="error">Erro: {status.message}</div>}
      {report && report.ruleErrors?.length > 0 && (
        <div className="error">Regras de boss com erro: {report.ruleErrors.join('; ')}</div>
      )}

      <div className="layout">
        {sidebarOpen ? (
          <Sidebar
            onCollapse={toggleSidebar}
            history={history}
            report={report}
            busy={status.kind === 'loading'}
            onNew={() => setPage('browse')}
            page={browsing ? 'browse' : page}
            onTrends={() => setPage('trends')}
            onSettings={() => openSettings()}
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
            // fora da análise (evolução, configurações) nenhum pull ou resumo fica destacado
            summary={page === 'analysis' ? summary : ''}
            onSummary={(k) => {
              setPage('analysis');
              setSummary(k);
            }}
          />
        ) : (
          <SidebarRail
            history={history}
            report={report}
            page={browsing ? 'browse' : page}
            onNew={() => setPage('browse')}
            onTrends={() => setPage('trends')}
            onSettings={() => openSettings()}
            onOpenEntry={openEntry}
            onExpand={toggleSidebar}
          />
        )}
        <main className="content">
          {page === 'settings' ? (
            <SettingsView
              focus={settingsFocus}
              report={report}
              appVersion={updater.version}
              updateState={updateState}
              onCheckUpdates={() => updater.checkNow(true)}
              firstRun={firstRun}
              onStart={() => {
                setFirstRun(false);
                setPage('browse');
              }}
            />
          ) : page === 'trends' ? (
            solo ? <SoloTrendsView /> : <TrendsView />
          ) : browsing ? (
            inTauri || demoLogs ? (
              <>
                {!report && <Intro />}
                <LogBrowser history={history} busy={status.kind === 'loading'} onAnalyze={analyzePath} onOpenFile={openFile} />
              </>
            ) : (
              <Empty hasHistory={history.length > 0} />
            )
          ) : summary === NIGHT ? (
            solo ? <SoloNightView pulls={pulls} onSelectPull={selectPull} /> : <NightOverview pulls={pulls} onSelectPull={selectPull} onSelectBoss={setSummary} />
          ) : summary != null ? (
            solo ? (
              <SoloBossView key={summary} title={summary} pulls={pulls.filter((p) => bossKey(p) === summary)} onSelectPull={selectPull} />
            ) : (
              <BossSummary key={summary} title={summary} pulls={pulls.filter((p) => bossKey(p) === summary)} onSelectPull={selectPull} />
            )
          ) : pull ? (
            <PullView
              pull={pull}
              wclCode={wclCode ?? undefined}
              povs={videos.get(pull.id)}
              nightPulls={pulls.filter((x) => bossKey(x) === bossKey(pull))}
              onRulesChanged={rulesChanged}
            />
          ) : (
            <p className="muted">{messagesOf(appMsg).noPulls}</p>
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
    </PlayerClassesContext.Provider>
    </SetupContext.Provider>
  );
}

/** Dev no navegador: `?demoLogs=1` mostra a lista de logs de exemplo. */
const demoLive = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoLive');
const demoUpdate = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoUpdate');
const demoLogs = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoLogs');
const demoTrends = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoTrends');
const demoSettings = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoSettings');

/** Tela inicial do app, acima da lista de logs. */
function Intro() {
  const { status, openSettings } = useSetup();
  const optional = optionalDone(status);
  const t = useMessages(appMsg);
  return (
    <div className="intro">
      <Crosshair size={32} strokeWidth={1.5} className="empty-mark" aria-hidden />
      <div>
        <h1>{t.title}</h1>
        <p className="muted">{t.intro()}</p>
        {status && optional.done < optional.total && (
          <button className="intro-setup" onClick={() => openSettings()}>
            <Settings size={14} strokeWidth={1.5} aria-hidden />
            <span>
              <span className="tabular">{t.outOf(optional.done, optional.total)}</span> {t.integrations}
            </span>
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function Empty({ hasHistory }: { hasHistory: boolean }) {
  const t = useMessages(appMsg);
  return (
    <div className="empty">
      <Crosshair size={40} strokeWidth={1.5} className="empty-mark" aria-hidden />
      <h1>{t.title}</h1>
      <p className="muted small">{t.browserMode()}</p>
      {hasHistory && <p className="muted small">{t.orHistory}</p>}
    </div>
  );
}
