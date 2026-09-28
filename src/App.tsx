import { useEffect, useMemo, useState } from 'react';
import type { LogReport } from './types';
import { analyzeLog, inTauri, lastFile, pickLogFile, readReportFile, rememberFile } from './lib/api';
import { PullList } from './components/PullList';
import { PullView } from './components/PullView';

type Status = { kind: 'idle' } | { kind: 'loading'; progress: number; path: string } | { kind: 'error'; message: string };

export default function App() {
  const [report, setReport] = useState<LogReport | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const previous = lastFile();

  // Dev no navegador: ?report=/samples/report.json carrega um relatório gerado pelo wipe-cli.
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('report');
    if (import.meta.env.DEV && !inTauri && url) {
      fetch(url)
        .then((r) => r.json())
        .then(showReport)
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
  }

  async function openFile() {
    const path = await pickLogFile();
    if (path) await load(path);
  }

  const pull = useMemo(() => report?.pulls.find((p) => p.id === selected) ?? null, [report, selected]);

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
          <span className="file muted" title={report.file}>
            {report.file.split(/[\\/]/).pop()} · {report.pulls.length} pulls · {(report.parseMs / 1000).toFixed(1)}s
            {!report.advancedLogging && <span className="warn"> · Advanced Combat Logging desligado</span>}
          </span>
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

      {!report ? (
        <Empty previous={inTauri ? previous : null} onReopen={load} />
      ) : (
        <div className="layout">
          <PullList pulls={report.pulls} selected={selected} onSelect={setSelected} />
          <main className="content">{pull ? <PullView pull={pull} /> : <p className="muted">Nenhum pull no log.</p>}</main>
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
