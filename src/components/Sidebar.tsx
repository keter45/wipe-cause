import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, FileX, PanelLeftOpen, Pin, PinOff, Plus, RefreshCw, Settings, Trash, TrendingUp } from 'lucide-react';
import type { LogReport, Pull } from '../types';
import { hasBackend, historyLoad, readReportFile, sameLog, type HistoryEntry, inDesktop } from '../lib/api';
import { logTitle, mainEncounterId, pct } from '../lib/format';
import { BossIcon, BossName } from './Names';
import type { UpdateState } from '../lib/updater';
import { missingRequired, useSetup } from '../lib/setup';
import { Fold, PullList, type PullListProps } from './PullList';

/** A análise aberta que ainda não está no histórico (ex.: relatório JSON). */
const CURRENT = 'current';
import { intlLocale, useMessages } from '../i18n';
import { sidebarMsg } from './Sidebar.i18n';

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
  const t = useMessages(sidebarMsg);
  const isOpen = (e: HistoryEntry) => report != null && sameLog(e.logPath, report.file);
  const pinned = history.filter((e) => e.pinned);
  const recent = history.filter((e) => !e.pinned);
  const current = report && !history.some(isOpen) ? report : null;
  const [confirmAll, setConfirmAll] = useState(false);
  // Cada noite abre e fecha sozinha e só mostra os pulls: não troca a tela. Uma noite salva que não está aberta
  // é lida do histórico só para a lista; escolher um pull ou um resumo nela é que abre a noite.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Map<string, Pull[] | 'loading' | 'error'>>(() => new Map());
  const openKey = report ? (history.find(isOpen)?.id ?? CURRENT) : null;
  useEffect(() => {
    if (openKey) setExpanded((s) => (s.has(openKey) ? s : new Set(s).add(openKey)));
  }, [openKey]);
  const toggle = (key: string, e?: HistoryEntry) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (e && !isOpen(e) && !loaded.has(e.id) && hasBackend) {
      setLoaded((m) => new Map(m).set(e.id, 'loading'));
      historyLoad(e.id)
        .then((r) => setLoaded((m) => new Map(m).set(e.id, r.pulls)))
        .catch(() => setLoaded((m) => new Map(m).set(e.id, 'error')));
    }
  };
  // pull ou resumo escolhido numa noite que não está aberta: abre a noite e vai até ele quando ela carregar
  const pendingGo = useRef<{ logPath: string; startMs?: number; summary?: string } | null>(null);
  useEffect(() => {
    const go = pendingGo.current;
    if (!go || !report || !sameLog(report.file, go.logPath)) return;
    pendingGo.current = null;
    if (go.startMs != null) {
      const p = report.pulls.find((x) => x.startMs === go.startMs);
      if (p) props.onSelect(p.id);
    } else if (go.summary) props.onSummary(go.summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
  const pullsOf = (e: HistoryEntry): ReactNode => {
    if (isOpen(e)) return <PullList {...props} />;
    const got = loaded.get(e.id);
    if (!Array.isArray(got)) return <p className="muted small pull-tree-note">{got === 'error' ? t.loadFailed : t.loading}</p>;
    return (
      <PullList
        pulls={got}
        selected={null}
        summary=""
        onSelect={(id) => {
          pendingGo.current = { logPath: e.logPath, startMs: got.find((p) => p.id === id)?.startMs };
          props.onOpenEntry(e);
        }}
        onSummary={(key) => {
          pendingGo.current = { logPath: e.logPath, summary: key };
          props.onOpenEntry(e);
        }}
      />
    );
  };

  const row = (e: HistoryEntry) => (
    <EntryRow key={e.id} entry={e} open={isOpen(e)} expanded={expanded.has(e.id)} onToggle={() => toggle(e.id, e)} {...props}>
      {pullsOf(e)}
    </EntryRow>
  );

  return (
    <aside className="sidebar" aria-label={t.aria}>
      <div className="sidebar-top">
        {hasBackend ? (
          <button className={`side-pill primary ${props.page === 'browse' ? 'active' : ''}`} onClick={props.onNew} aria-current={props.page === 'browse' ? 'page' : undefined}>
            {t.newAnalysis}
          </button>
        ) : (
          <label className="side-pill primary">
            {t.openJson}
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
        <button className={`side-pill ${props.page === 'trends' ? 'active' : ''}`} onClick={props.onTrends} aria-current={props.page === 'trends' ? 'page' : undefined}>
          {t.trends}
        </button>
        <button className="icon-btn sidebar-collapse" onClick={props.onCollapse} title={t.collapse} aria-label={t.collapse}>
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div className="sidebar-scroll">
        {(current || history.length > 0) && (
          <Section
            title={t.nights}
            action={
              recent.length === 0 ? null : confirmAll ? (
                <span className="confirm-inline">
                  <button
                    className="confirm-yes"
                    onClick={() => {
                      props.onDeleteUnpinned();
                      setConfirmAll(false);
                    }}
                  >
                    {t.deleteN(recent.length)}
                  </button>
                  <button className="confirm-no" onClick={() => setConfirmAll(false)}>
                    {t.cancel}
                  </button>
                </span>
              ) : (
                <button className="icon-btn sm" onClick={() => setConfirmAll(true)} title={t.deleteUnpinned} aria-label={t.deleteUnpinned}>
                  <Trash size={14} strokeWidth={1.5} aria-hidden />
                </button>
              )
            }
          >
            {/* a análise aberta que ainda não está no histórico (ex.: relatório JSON), depois as fixadas e as recentes */}
            {current && (
              <NightRow
                title={logTitle(current.pulls)}
                encounterId={mainEncounterId(current.pulls)}
                info={current.file}
                open
                expanded={expanded.has(CURRENT)}
                onToggle={() => toggle(CURRENT)}
              >
                <PullList {...props} />
              </NightRow>
            )}
            {pinned.map(row)}
            {recent.map(row)}
          </Section>
        )}

        {history.length === 0 && !current && (
          <p className="sidebar-empty">{t.empty}</p>
        )}
      </div>

      <div className="sidebar-foot">
        <SettingsItem active={props.page === 'settings'} onClick={props.onSettings} />
        {inDesktop && <VersionChip version={props.appVersion} state={props.updateState} onCheck={props.onCheckUpdates} />}
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

/** "24/09 21:05" (pt) / "09/24, 9:05 PM" (en) */
function savedLabel(ms: number): string {
  return new Date(ms).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function EntryRow({
  entry: e,
  open,
  expanded,
  onToggle,
  children,
  ...props
}: { entry: HistoryEntry; open: boolean; expanded: boolean; onToggle: () => void; children: ReactNode } & Props) {
  const t = useMessages(sidebarMsg);
  const [confirm, setConfirm] = useState(false);
  const info = [
    t.pulls(e.pulls),
    e.kills ? t.kills(e.kills) : null,
    e.bestHp != null && !e.kills ? t.best(e.bestPhase ? `${e.bestPhase} ${pct(e.bestHp)}` : pct(e.bestHp)) : null,
    e.deathCutoff ? t.cutoff(e.deathCutoff) : null,
    t.saved(savedLabel(e.savedAt)),
    `${(e.size / 1e6).toFixed(1)} MB`,
    e.logExists ? null : t.logMissing,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <NightRow
      title={e.title}
      encounterId={e.encounterId ?? null}
      info={info}
      open={open}
      expanded={expanded}
      pinned={e.pinned}
      missing={!e.logExists}
      onToggle={() => (open || hasBackend ? onToggle() : props.onOpenEntry(e))}
      confirm={
        confirm && (
          <span className="confirm-inline full">
            <span className="confirm-text">{t.confirmDelete(e.title)}</span>
            <button
              className="confirm-yes"
              onClick={() => {
                props.onDelete(e);
                setConfirm(false);
              }}
            >
              {t.delete}
            </button>
            <button className="confirm-no" onClick={() => setConfirm(false)} autoFocus>
              {t.cancel}
            </button>
          </span>
        )
      }
      actions={
        <>
          <button className="icon-btn sm" onClick={() => props.onTogglePin(e)} title={e.pinned ? t.unpin : t.pinKeep} aria-label={e.pinned ? t.unpin : t.pin}>
            {e.pinned ? <PinOff size={14} strokeWidth={1.5} aria-hidden /> : <Pin size={14} strokeWidth={1.5} aria-hidden />}
          </button>
          <button className="icon-btn sm" onClick={() => setConfirm(true)} title={t.deleteFromHistory} aria-label={t.deleteFromHistory}>
            <Trash size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </>
      }
    >
      {children}
    </NightRow>
  );
}

/** "15/10 · The Coiled Altar Mythic" -> data e título, para a data ficar em destaque à esquerda. */
function splitTitle(title: string): { date: string | null; name: string } {
  const m = title.match(/^(\d{1,2}\/\d{1,2})\s*·\s*(.+)$/);
  return m ? { date: m[1], name: m[2] } : { date: null, name: title };
}

/**
 * Uma noite: a data, o ícone e o nome do boss principal; a linha inteira abre e fecha os pulls (com as linhas-guia
 * da árvore). Fixar e apagar aparecem ao passar o mouse.
 */
function NightRow({
  title,
  encounterId,
  info,
  open,
  expanded,
  pinned = false,
  missing = false,
  onToggle,
  confirm,
  actions,
  children,
}: {
  title: string;
  encounterId: number | null;
  info: string;
  open: boolean;
  expanded: boolean;
  pinned?: boolean;
  missing?: boolean;
  onToggle: () => void;
  confirm?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useMessages(sidebarMsg);
  const { date, name } = splitTitle(title);
  return (
    <div className={`side-night ${expanded ? 'expanded' : ''} ${open ? 'active' : ''}`}>
      {confirm ? (
        <div className="side-night-head confirming">{confirm}</div>
      ) : (
        <div className="side-night-head">
          <button className="side-night-main" onClick={onToggle} title={info} aria-expanded={expanded}>
            {date && <span className="side-night-date">{date}</span>}
            <span className="side-night-title">
              <BossName encounterId={encounterId} name={name} size={18} />
            </span>
            {pinned && <Pin size={12} strokeWidth={1.75} className="side-night-pinned" aria-label={t.pinned} />}
            {missing && <FileX size={13} strokeWidth={1.5} className="side-night-missing" aria-label={t.logMissing} />}
            <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${expanded ? 'open' : ''}`} aria-hidden />
          </button>
          {actions && <span className="side-night-actions">{actions}</span>}
        </div>
      )}
      <Fold open={expanded}>
        <div className="side-night-tree">{children}</div>
      </Fold>
    </div>
  );
}

/** Configurações no rodapé; um alerta quando falta algo essencial (a pasta de logs). */
function SettingsItem({ active, onClick }: { active: boolean; onClick: () => void }) {
  const t = useMessages(sidebarMsg);
  const { status } = useSetup();
  const missing = missingRequired(status);
  return (
    <button className={`side-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Settings size={16} strokeWidth={1.5} aria-hidden /> {t.settings}
      {missing && (
        <span className="side-alert" title={t.missingTitle}>
          {t.missing}
        </span>
      )}
    </button>
  );
}

/** Versão no rodapé, na linha das Configurações: clique procura atualização; ponto = versão nova. */
function VersionChip({ version, state, onCheck }: { version: string | null; state: UpdateState; onCheck: () => void }) {
  const t = useMessages(sidebarMsg);
  const label =
    state.kind === 'checking'
      ? t.checking
      : state.kind === 'none'
        ? t.latest
        : state.kind === 'available'
          ? t.available(state.version)
          : state.kind === 'downloading'
            ? t.downloading
            : t.check;
  const busy = state.kind === 'checking' || state.kind === 'downloading';
  return (
    <button className={`version-chip ${state.kind === 'available' ? 'has-update' : ''}`} onClick={onCheck} disabled={busy} title={label} aria-label={`Wipe Cause ${version ?? ''}: ${label}`}>
      {busy ? <RefreshCw size={11} strokeWidth={1.75} className="spin" aria-hidden /> : state.kind === 'available' && <span className="update-dot" aria-hidden />}
      {version ? `v${version}` : t.version}
    </button>
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
  const t = useMessages(sidebarMsg);
  const { status } = useSetup();
  const isOpen = (e: HistoryEntry) => report != null && sameLog(e.logPath, report.file);
  const entries = [...history.filter((e) => e.pinned), ...history.filter((e) => !e.pinned)].slice(0, 8);
  const item = (label: string, active: boolean, onClick: () => void, icon: ReactNode, extra?: string) => (
    <button className={`rail-item ${active ? 'active' : ''} ${extra ?? ''}`} onClick={onClick} title={label} aria-label={label} aria-current={active ? 'page' : undefined}>
      {icon}
    </button>
  );
  return (
    <nav className="sidebar-rail" aria-label={t.aria}>
      {item(t.expand, false, onExpand, <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden />)}
      {hasBackend && item(t.newAnalysis, page === 'browse', onNew, <Plus size={16} strokeWidth={2} aria-hidden />, 'new')}
      {item(t.trends, page === 'trends', onTrends, <TrendingUp size={16} strokeWidth={1.5} aria-hidden />)}
      <span className="rail-sep" aria-hidden />
      <div className="rail-entries">
        {/* análise aberta que ainda não está no histórico (ex.: relatório JSON) */}
        {report && !history.some(isOpen) && item(logTitle(report.pulls), page === 'analysis', onExpand, <BossIcon encounterId={mainEncounterId(report.pulls)} size={20} />)}
        {entries.map((e) => (
          <span key={e.id}>{item(e.title, isOpen(e) && page === 'analysis', () => onOpenEntry(e), <BossIcon encounterId={e.encounterId ?? null} size={20} />)}</span>
        ))}
      </div>
      {item(
        missingRequired(status) ? t.settingsMissing : t.settings,
        page === 'settings',
        onSettings,
        <Settings size={16} strokeWidth={1.5} aria-hidden />,
        missingRequired(status) ? 'alert' : undefined,
      )}
    </nav>
  );
}
