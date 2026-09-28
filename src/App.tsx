import { useEffect, useMemo, useState } from 'react';
import type { LogReport } from './types';
import { analyzeLog, inTauri, lastFile, pickLogFile, readReportFile, rememberFile } from './lib/api';
import { PullList } from './components/PullList';
import { NightSummary } from './components/NightSummary';
import { applyCutoff, savedDeathCutoff, saveDeathCutoff } from './lib/cutoff';
import { PullView } from './components/PullView';
import { IntegrationsBar } from './components/IntegrationsBar';
import type { WcrScan, WcrVideo } from './lib/api';
import { matchVideos } from './lib/wcr';

type Status = { kind: 'idle' } | { kind: 'loading'; progress: number; path: string } | { kind: 'error'; message: string };

export default function App() {
  const [report, setReport] = useState<LogReport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showSummary, setShowSummary] = useState(true);
  const [deathCutoff, setDeathCutoff] = useState(savedDeathCutoff);
  const changeCutoff = (n: number) => {
    setDeathCutoff(n);
    saveDeathCutoff(n);
  };
  const selectPull = (id: number) => {
    setSelected(id);
    setShowSummary(false);
  };
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [wclCode, setWclCode] = useState<string | null>(null);
  const [videos, setVideos] = useState<Map<number, WcrVideo>>(new Map());
  const previous = lastFile();

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

  async function load(path: string) {
    setStatus({ kind: 'loading', progress: 0, path });
    try {
      const r = await analyzeLog(path, (progress) => setStatus({ kind: 'loading', progress, path }));
      rememberFile(path);
      showReport(r);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'error', message: String(e) });
    }
  }

  function showReport(r: LogReport) {
    setReport(r);
    // abre no último wipe (normalmente o que a raid quer ver)
    const lastWipe = [...r.pulls].reverse().find((p) => !p.success) ?? r.pulls[r.pulls.length - 1];
    setSelected(lastWipe?.id ?? null);
    setShowSummary(true); // abre no resumo da noite
  }

  async function openFile() {
    const path = await pickLogFile();
    if (path) await load(path);
  }

  // pulls recortados em "ignorar eventos após N mortes" (instantâneo, sem reanalisar)
  const pulls = useMemo(() => report?.pulls.map((p) => applyCutoff(p, deathCutoff)) ?? [], [report, deathCutoff]);
  const pull = useMemo(() => pulls.find((p) => p.id === selected) ?? null, [pulls, selected]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✕</span> Wipe Cause
        </div>
        {inTauri ? (
          <>
            <button className="btn primary" onClick={openFile} disabled={status.kind === 'loading'}>
              Abrir combat log
            </button>
            {report && (
              <button className="btn" onClick={() => load(report.file)} disabled={status.kind === 'loading'}>
                Reanalisar
              </button>
            )}
          </>
        ) : (
          <label className="btn primary">
            Abrir relatório JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) showReport(await readReportFile(f));
              }}
            />
          </label>
        )}
        {report && (
          <>
          <label className="cutoff" title="Depois de algumas mortes o wipe já está decidido: erros, falhas e interrupts depois da N-ésima morte não contam (0 = conta tudo)">
            Ignorar após
            <input
              type="number"
              min={0}
              max={40}
              value={deathCutoff}
              onChange={(e) => changeCutoff(Math.max(0, Math.min(40, Number(e.target.value) || 0)))}
            />
            mortes
          </label>
          <span className="file muted" title={report.file}>
            {report.file.split(/[\\/]/).pop()} · {report.pulls.length} pulls
            {report.ignoredShortPulls > 0 && ` (+${report.ignoredShortPulls} com menos de 30s ignorados)`} ·{' '}
            {(report.parseMs / 1000).toFixed(1)}s
            {!report.advancedLogging && <span className="warn"> · Advanced Combat Logging desligado</span>}
          </span>
          </>
        )}
      </header>

      {status.kind === 'loading' && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${Math.round(status.progress * 100)}%` }} />
          <span>Analisando {status.path.split(/[\\/]/).pop()}… {Math.round(status.progress * 100)}%</span>
        </div>
      )}
      {status.kind === 'error' && <div className="error">Erro: {status.message}</div>}
      {report && report.ruleErrors?.length > 0 && (
        <div className="error">Regras de boss com erro: {report.ruleErrors.join('; ')}</div>
      )}

      {report && <IntegrationsBar logFile={report.file} pulls={report.pulls} onWcl={setWclCode} onVideos={setVideos} />}

      {!report ? (
        <Empty previous={inTauri ? previous : null} onReopen={load} />
      ) : (
        <div className="layout">
          <PullList
            pulls={report.pulls}
            selected={selected}
            onSelect={selectPull}
            summaryActive={showSummary}
            onSummary={() => setShowSummary(true)}
          />
          <main className="content">
            {showSummary ? (
              <NightSummary pulls={pulls} onSelectPull={selectPull} />
            ) : (
              <>
            {pull ? (
              <PullView
                pull={pull}
                wclCode={wclCode ?? undefined}
                video={videos.get(pull.id)}
              />
            ) : (
              <p className="muted">Nenhum pull no log.</p>
            )}
          </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function Empty({ previous, onReopen }: { previous: string | null; onReopen: (p: string) => void }) {
  return (
    <div className="empty">
      <h1>Por que deu wipe?</h1>
      <p>
        Abra o <code>WoWCombatLog.txt</code> da raid. Ele fica em{' '}
        <code>World of Warcraft\_retail_\Logs</code>.
      </p>
      <p className="muted">
        No jogo: digite <code>/combatlog</code> antes do pull e ative <em>Advanced Combat Logging</em> em Opções → Rede.
      </p>
      {!inTauri && (
        <p className="muted">
          Modo navegador: gere o relatório com <code>cargo run -p wipe-core --bin wipe-cli -- analyze log.txt --json</code>.
        </p>
      )}
      {previous && (
        <button className="btn" onClick={() => onReopen(previous)}>
          Reabrir {previous.split(/[\\/]/).pop()}
        </button>
      )}
    </div>
  );
}
