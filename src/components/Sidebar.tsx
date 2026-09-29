import { useState, type ReactNode } from 'react';
import { ChevronRight, FileX, Pin, PinOff, Plus, Trash } from 'lucide-react';
import type { LogReport } from '../types';
import { inTauri, readReportFile, sameLog, type HistoryEntry } from '../lib/api';
import { logTitle, pct } from '../lib/format';
import { PullList, type PullListProps } from './PullList';

interface Props extends PullListProps {
  history: HistoryEntry[];
  report: LogReport | null;
  busy: boolean;
  onNew: () => void;
  /** navegador (dev): abre um relatório JSON gerado pelo wipe-cli */
  onOpenJson: (r: LogReport) => void;
  onOpenEntry: (e: HistoryEntry) => void;
  onTogglePin: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
  onDeleteUnpinned: () => void;
}

/**
 * Barra lateral no estilo do Claude: "Nova análise", análises fixadas e recentes. A análise
 * aberta se expande e mostra o resumo da noite e os pulls.
 */
export function Sidebar(props: Props) {
  const { history, report } = props;
  const isOpen = (e: HistoryEntry) => report != null && sameLog(e.logPath, report.file);
  const pinned = history.filter((e) => e.pinned);
  const recent = history.filter((e) => !e.pinned);
  const current = report && !history.some(isOpen) ? report : null;
  const [confirmAll, setConfirmAll] = useState(false);

  const row = (e: HistoryEntry) => <EntryRow key={e.id} entry={e} open={isOpen(e)} {...props} />;

  return (
    <aside className="sidebar" aria-label="Análises">
      <div className="sidebar-top">
        {inTauri ? (
          <button className="side-item new" onClick={props.onNew} disabled={props.busy}>
            <Plus size={16} strokeWidth={2} aria-hidden /> Nova análise
          </button>
        ) : (
          <label className="side-item new">
            <Plus size={16} strokeWidth={2} aria-hidden /> Abrir relatório JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                if (f) props.onOpenJson(await readReportFile(f));
              }}
            />
          </label>
        )}
      </div>

      <div className="sidebar-scroll">
        {current && (
          <Section title="Aberta agora">
            <div className="side-entry open">
              <div className="side-item entry active">
                <ChevronRight size={14} strokeWidth={1.5} className="entry-chev" aria-hidden />
                <span className="entry-title" title={current.file}>
                  {logTitle(current.pulls)}
                </span>
              </div>
              <PullList {...props} />
            </div>
          </Section>
        )}

        {pinned.length > 0 && <Section title="Fixadas">{pinned.map(row)}</Section>}

        {recent.length > 0 && (
          <Section
            title="Recentes"
            action={
              confirmAll ? (
                <span className="confirm-inline">
                  <button
                    className="confirm-yes"
                    onClick={() => {
                      props.onDeleteUnpinned();
                      setConfirmAll(false);
                    }}
                  >
                    Apagar {recent.length}
                  </button>
                  <button className="confirm-no" onClick={() => setConfirmAll(false)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button className="icon-btn sm" onClick={() => setConfirmAll(true)} title="Apagar todas as análises não fixadas" aria-label="Apagar todas as análises não fixadas">
                  <Trash size={14} strokeWidth={1.5} aria-hidden />
                </button>
              )
            }
          >
            {recent.map(row)}
          </Section>
        )}

        {history.length === 0 && !current && (
          <p className="sidebar-empty">As análises ficam salvas aqui, com data. Abra um combat log para começar.</p>
        )}
      </div>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="side-section">
      <h3>
        <span>{title}</span>
        {action}
      </h3>
      {children}
    </section>
  );
}

function savedLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function EntryRow({ entry: e, open, ...props }: { entry: HistoryEntry; open: boolean } & Props) {
  const [confirm, setConfirm] = useState(false);
  const info = [
    `${e.pulls} pulls`,
    e.kills ? `${e.kills} kill${e.kills > 1 ? 's' : ''}` : null,
    e.bestHp != null && !e.kills ? `melhor ${pct(e.bestHp)}` : null,
    e.deathCutoff ? `corte ${e.deathCutoff} mortes` : null,
    `salvo ${savedLabel(e.savedAt)}`,
    `${(e.size / 1e6).toFixed(1)} MB`,
    e.logExists ? null : 'log original não encontrado',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`side-entry ${open ? 'open' : ''}`}>
      <div className={`side-item entry ${open ? 'active' : ''} ${confirm ? 'confirming' : ''}`}>
        {confirm ? (
          <span className="confirm-inline full">
            <span className="confirm-text">Apagar “{e.title}”?</span>
            <button
              className="confirm-yes"
              onClick={() => {
                props.onDelete(e);
                setConfirm(false);
              }}
            >
              Apagar
            </button>
            <button className="confirm-no" onClick={() => setConfirm(false)} autoFocus>
              Cancelar
            </button>
          </span>
        ) : (
          <>
            <button className="entry-main" onClick={() => props.onOpenEntry(e)} title={info} aria-expanded={open}>
              <ChevronRight size={14} strokeWidth={1.5} className="entry-chev" aria-hidden />
              <span className="entry-title">{e.title}</span>
              {!e.logExists && <FileX size={13} strokeWidth={1.5} className="entry-missing" aria-label="log original não encontrado" />}
            </button>
            <span className="entry-actions">
              <button
                className="icon-btn sm"
                onClick={() => props.onTogglePin(e)}
                title={e.pinned ? 'Desafixar' : 'Fixar (manter)'}
                aria-label={e.pinned ? 'Desafixar' : 'Fixar'}
              >
                {e.pinned ? <PinOff size={14} strokeWidth={1.5} aria-hidden /> : <Pin size={14} strokeWidth={1.5} aria-hidden />}
              </button>
              <button className="icon-btn sm" onClick={() => setConfirm(true)} title="Apagar do histórico" aria-label="Apagar do histórico">
                <Trash size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          </>
        )}
      </div>
      {open && <PullList {...props} />}
    </div>
  );
}
