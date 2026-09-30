import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, FileX, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Plus, RefreshCw, Settings, Trash, TrendingUp } from 'lucide-react';
import type { LogReport } from '../types';
import { inTauri, readReportFile, sameLog, type HistoryEntry } from '../lib/api';
import { logTitle, mainEncounterId, pct } from '../lib/format';
import { BossIcon, BossName } from './Names';
import type { UpdateState } from '../lib/updater';
import { missingRequired, useSetup } from '../lib/setup';
import { NIGHT, PullList, type PullListProps } from './PullList';

interface Props extends PullListProps {
  history: HistoryEntry[];
  report: LogReport | null;
  busy: boolean;
  onNew: () => void;
  /** página aberta na área principal (destaca o item da navegação) */
  page: 'analysis' | 'browse' | 'trends' | 'settings';
  onTrends: () => void;
  onSettings: () => void;
  appVersion: string | null;
  updateState: UpdateState;
  onCheckUpdates: () => void;
  /** navegador (dev): abre um relatório JSON gerado pelo wipe-cli */
  onOpenJson: (r: LogReport) => void;
  onOpenEntry: (e: HistoryEntry) => void;
  onTogglePin: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
  onDeleteUnpinned: () => void;
  /** recolher para a coluna de ícones */
  onCollapse: () => void;
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
  // a análise aberta começa expandida; clicar nela recolhe/expande a lista de pulls
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [report]);
  const toggleOpen = () => {
    if (collapsed) props.onSummary(NIGHT); // reabrir leva ao resumo da noite
    setCollapsed(!collapsed);
  };

  const row = (e: HistoryEntry) => (
    <EntryRow key={e.id} entry={e} open={isOpen(e)} expanded={isOpen(e) && !collapsed} onToggle={toggleOpen} {...props} />
  );

  return (
    <aside className="sidebar" aria-label="Análises">
      <div className="sidebar-top">
        <button className="icon-btn sidebar-collapse" onClick={props.onCollapse} title="Recolher barra lateral" aria-label="Recolher barra lateral">
          <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden />
        </button>
        {inTauri ? (
          <button className={`side-item new ${props.page === 'browse' ? 'active' : ''}`} onClick={props.onNew} aria-current={props.page === 'browse' ? 'page' : undefined}>
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
        <button className={`side-item ${props.page === 'trends' ? 'active' : ''}`} onClick={props.onTrends} aria-current={props.page === 'trends' ? 'page' : undefined}>
          <TrendingUp size={16} strokeWidth={1.5} aria-hidden /> Evolução
        </button>
      </div>

      <div className="sidebar-scroll">
        {current && (
          <Section title="Aberta agora">
            <div className={`side-entry ${collapsed ? '' : 'open'}`}>
              <div className="side-item entry active">
                <button className="entry-main" onClick={toggleOpen} title={current.file} aria-expanded={!collapsed}>
                  <ChevronRight size={14} strokeWidth={1.5} className="entry-chev" aria-hidden />
                  <span className="entry-title">
                    <BossName encounterId={mainEncounterId(current.pulls)} name={logTitle(current.pulls)} size={16} />
                  </span>
                </button>
              </div>
              {!collapsed && <PullList {...props} />}
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

      <div className="sidebar-foot">
        <SettingsItem active={props.page === 'settings'} onClick={props.onSettings} />
        {inTauri && <UpdateFooter version={props.appVersion} state={props.updateState} onCheck={props.onCheckUpdates} />}
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

function EntryRow({
  entry: e,
  open,
  expanded,
  onToggle,
  ...props
}: { entry: HistoryEntry; open: boolean; expanded: boolean; onToggle: () => void } & Props) {
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
    <div className={`side-entry ${expanded ? 'open' : ''}`}>
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
            <button className="entry-main" onClick={() => (open ? onToggle() : props.onOpenEntry(e))} title={info} aria-expanded={expanded}>
              <ChevronRight size={14} strokeWidth={1.5} className="entry-chev" aria-hidden />
              <span className="entry-title">
                <BossName encounterId={e.encounterId} name={e.title} size={16} />
              </span>
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
      {expanded && <PullList {...props} />}
    </div>
  );
}

/** Configurações no rodapé; um alerta quando falta algo essencial (a pasta de logs). */
function SettingsItem({ active, onClick }: { active: boolean; onClick: () => void }) {
  const { status } = useSetup();
  const missing = missingRequired(status);
  return (
    <button className={`side-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Settings size={16} strokeWidth={1.5} aria-hidden /> Configurações
      {missing && (
        <span className="side-alert" title="Falta configurar a pasta de logs do WoW">
          falta configurar
        </span>
      )}
    </button>
  );
}

function UpdateFooter({ version, state, onCheck }: { version: string | null; state: UpdateState; onCheck: () => void }) {
  const label =
    state.kind === 'checking'
      ? 'Procurando…'
      : state.kind === 'none'
        ? 'Você está na versão mais recente'
        : state.kind === 'available'
          ? `Versão ${state.version} disponível`
          : state.kind === 'downloading'
            ? 'Baixando atualização…'
            : 'Procurar atualizações';
  return (
    <div className="update-foot">
      <span className="muted small">{version ? `Wipe Cause v${version}` : 'Wipe Cause'}</span>
      <button className="foot-check small" onClick={onCheck} disabled={state.kind === 'checking' || state.kind === 'downloading'} title="Procurar atualizações">
        <RefreshCw size={12} strokeWidth={1.5} className={state.kind === 'checking' ? 'spin' : ''} aria-hidden /> {label}
      </button>
    </div>
  );
}

interface RailProps {
  history: HistoryEntry[];
  report: LogReport | null;
  page: Props['page'];
  onNew: () => void;
  onTrends: () => void;
  onSettings: () => void;
  onOpenEntry: (e: HistoryEntry) => void;
  onExpand: () => void;
}

/** Barra lateral recolhida: uma coluna de ícones (40px) com os atalhos e as análises recentes. */
export function SidebarRail({ history, report, page, onNew, onTrends, onSettings, onOpenEntry, onExpand }: RailProps) {
  const { status } = useSetup();
  const isOpen = (e: HistoryEntry) => report != null && sameLog(e.logPath, report.file);
  const entries = [...history.filter((e) => e.pinned), ...history.filter((e) => !e.pinned)].slice(0, 8);
  const item = (label: string, active: boolean, onClick: () => void, icon: ReactNode, extra?: string) => (
    <button className={`rail-item ${active ? 'active' : ''} ${extra ?? ''}`} onClick={onClick} title={label} aria-label={label} aria-current={active ? 'page' : undefined}>
      {icon}
    </button>
  );
  return (
    <nav className="sidebar-rail" aria-label="Análises">
      {item('Mostrar barra lateral', false, onExpand, <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden />)}
      {inTauri && item('Nova análise', page === 'browse', onNew, <Plus size={16} strokeWidth={2} aria-hidden />, 'new')}
      {item('Evolução', page === 'trends', onTrends, <TrendingUp size={16} strokeWidth={1.5} aria-hidden />)}
      <span className="rail-sep" aria-hidden />
      <div className="rail-entries">
        {/* análise aberta que ainda não está no histórico (ex.: relatório JSON) */}
        {report && !history.some(isOpen) && item(logTitle(report.pulls), page === 'analysis', onExpand, <BossIcon encounterId={mainEncounterId(report.pulls)} size={20} />)}
        {entries.map((e) => (
          <span key={e.id}>{item(e.title, isOpen(e) && page === 'analysis', () => onOpenEntry(e), <BossIcon encounterId={e.encounterId ?? null} size={20} />)}</span>
        ))}
      </div>
      {item(
        missingRequired(status) ? 'Configurações (falta configurar a pasta de logs)' : 'Configurações',
        page === 'settings',
        onSettings,
        <Settings size={16} strokeWidth={1.5} aria-hidden />,
        missingRequired(status) ? 'alert' : undefined,
      )}
    </nav>
  );
}
