import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Check, ChevronDown, CircleAlert, FolderOpen, Gamepad2, Info, MessageSquare, Power, RefreshCw, Skull, Trophy, Video, type LucideIcon } from 'lucide-react';
import type { LogReport } from '../../types';
import {
  inTauri,
  logsDetectDir,
  logsGetDir,
  logsList,
  logsSetDir,
  migrateWcrDir,
  revealInExplorer,
  rulesDir,
  wcrDetectDir,
  wcrGetDir,
  wcrSetDir,
  wcrVideos,
} from '../../lib/api';
import { PRESETS } from '../../lib/ai';
import { savedDeathCutoff, saveDeathCutoff } from '../../lib/cutoff';
import { missingRequired, optionalDone, useSetup, type SettingsSection } from '../../lib/setup';
import type { UpdateState } from '../../lib/updater';
import { CutoffStepper } from '../CutoffStepper';
import { AiForm } from './AiForm';
import { DiscordForm } from './DiscordForm';
import { FolderForm, type FolderApi } from './FolderForm';
import { WclApiForm } from './WclApiForm';
import { FirstSteps } from './FirstSteps';
import { StartupForm } from './StartupForm';
import { WcrCloudForm } from './WcrCloudForm';
import { LOCALES, messagesOf, setLocale, useLocale, useMessages, type Locale } from '../../i18n';
import { settingsMsg } from './SettingsView.i18n';

type Tone = 'ok' | 'todo' | 'off' | 'info';

interface Props {
  /** seção pedida por um atalho (abre e rola até ela); `n` muda a cada pedido */
  focus: { section: SettingsSection; n: number } | null;
  /** log aberto: diz se o Advanced Combat Logging estava ligado */
  report: LogReport | null;
  appVersion: string | null;
  updateState: UpdateState;
  onCheckUpdates: () => void;
  /** primeira vez no app: o passo a passo aparece aberto */
  firstRun: boolean;
  /** "Começar": vai para a escolha da noite */
  onStart: () => void;
}

const LOGS_API: FolderApi = {
  get: logsGetDir,
  set: logsSetDir,
  detect: logsDetectDir,
  scan: async () => {
    const s = await logsList();
    return { dir: s.dir, warning: s.warning, found: messagesOf(settingsMsg).logsFound(s.files.length) };
  },
};

const VIDEOS_API: FolderApi = {
  get: wcrGetDir,
  set: wcrSetDir,
  detect: wcrDetectDir,
  scan: async () => {
    await migrateWcrDir();
    const s = await wcrVideos();
    return { dir: s.dir, warning: s.warning, found: messagesOf(settingsMsg).videosFound(s.videos.length) };
  },
};

/**
 * Tudo o que o app precisa, num lugar: o essencial (pasta de logs e combat log no jogo), o
 * padrão da análise e as integrações opcionais. Cada cartão mostra o status e abre o formulário.
 */
export function SettingsView({ focus, report, appVersion, updateState, onCheckUpdates, firstRun, onStart }: Props) {
  const { status, reload } = useSetup();
  const t = useMessages(settingsMsg);
  const [open, setOpen] = useState<Set<SettingsSection>>(() => new Set(focus ? [focus.section] : []));
  const toggle = (s: SettingsSection) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // atalho de outra tela: abre a seção e rola até ela
  useEffect(() => {
    if (!focus) return;
    setOpen((prev) => new Set(prev).add(focus.section));
    // depois do cartão abrir (senão a rolagem é interrompida pelo novo layout)
    const id = window.setTimeout(() => document.getElementById(`set-${focus.section}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    return () => window.clearTimeout(id);
  }, [focus]);

  /** abre o cartão e rola até ele (passo a passo) */
  const openSection = (s: SettingsSection) => {
    setOpen((prev) => new Set(prev).add(s));
    window.setTimeout(() => document.getElementById(`set-${s}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };

  // o essencial que falta já começa aberto
  const logsMissing = missingRequired(status);
  useEffect(() => {
    if (logsMissing) setOpen((prev) => new Set(prev).add('logs'));
  }, [logsMissing]);

  const [cutoff, setCutoff] = useState(savedDeathCutoff);
  const optional = optionalDone(status);
  const aiPreset = PRESETS.find((p) => p.id === status?.ai?.provider);
  const acl = report ? (report.advancedLogging ? 'on' : 'off') : 'unknown';

  const card = (id: SettingsSection, icon: LucideIcon, title: string, desc: string, tone: Tone, label: string, body: ReactNode) => (
    <SettingsCard key={id} id={id} icon={icon} title={title} desc={desc} tone={tone} label={label} open={open.has(id)} onToggle={() => toggle(id)}>
      {body}
    </SettingsCard>
  );

  return (
    <div className="settings">
      <header className="set-head">
        <div className="set-title-row">
          <h1>{t.title}</h1>
          <LanguageSelect label={t.language} />
        </div>
        <p className="muted">{t.intro}</p>
        {status && (
          <div className="set-summary">
            <span className={`set-chip ${logsMissing ? 'todo' : 'ok'}`}>
              {logsMissing ? <CircleAlert size={14} strokeWidth={2} aria-hidden /> : <Check size={14} strokeWidth={2} aria-hidden />}
              {logsMissing ? t.logsMissing : t.essentialReady}
            </span>
            <span className="set-chip">{t.integrationsOn(optional.done, optional.total)}</span>
          </div>
        )}
      </header>
      <FirstSteps firstRun={firstRun} onStart={onStart} onOpen={openSection} />

      <SettingsGroup title={t.groups.essential} hint={t.groups.essentialHint}>
        {card(
          'logs',
          FolderOpen,
          t.logs.title,
          t.logs.desc,
          !status ? 'info' : logsMissing ? 'todo' : 'ok',
          !status ? '…' : logsMissing ? t.logs.missing : status.logsSource === 'detected' ? t.logs.detected : t.logs.configured,
          <FolderForm api={LOGS_API} pickTitle={t.logs.pickTitle} placeholder="C:\Program Files (x86)\World of Warcraft\_retail_\Logs" detectedLabel={t.logs.detectedLabel} onSaved={reload} />,
        )}
        {card(
          'game',
          Gamepad2,
          t.game.title,
          t.game.desc,
          acl === 'on' ? 'ok' : acl === 'off' ? 'todo' : 'info',
          acl === 'on' ? t.game.on : acl === 'off' ? t.game.off : t.game.check,
          <ol className="small set-steps">
            <li>{t.game.step1()}</li>
            <li>{t.game.step2()}</li>
            <li>{t.game.step3}</li>
          </ol>,
        )}
      </SettingsGroup>

      <SettingsGroup title={t.groups.startup}>
        {card(
          'startup',
          Power,
          t.startup.title,
          t.startup.desc,
          status?.openWithWow ? 'ok' : 'off',
          status?.openWithWow ? t.on : t.off,
          inTauri ? <StartupForm enabled={!!status?.openWithWow} onSaved={reload} /> : <OnlyInApp />,
        )}
      </SettingsGroup>

      <SettingsGroup title={t.groups.analysis}>
        {card(
          'analysis',
          Skull,
          t.cutoff.title,
          t.cutoff.desc,
          'info',
          t.cutoff.label(cutoff),
          <>
            <CutoffStepper
              value={cutoff}
              disabled={false}
              title={t.cutoff.stepper}
              onChange={(n) => {
                setCutoff(n);
                saveDeathCutoff(n);
              }}
            />
            <p className="muted small">{t.cutoff.note}</p>
          </>,
        )}
      </SettingsGroup>

      <SettingsGroup title={t.groups.integrations} hint={t.groups.integrationsHint}>
        {card(
          'wcl',
          Trophy,
          'Warcraft Logs',
          t.wcl.desc,
          status?.wcl?.configured ? 'ok' : 'off',
          status?.wcl?.user ? t.wcl.connectedAs(status.wcl.user.name) : status?.wcl?.configured ? t.wcl.connected : t.wcl.notConnected,
          inTauri ? <WclApiForm current={status?.wcl ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
        {card(
          'videos',
          Video,
          t.videos.title,
          t.videos.desc,
          status?.wcrDir || status?.wcrCloud?.configured ? 'ok' : 'off',
          [status?.wcrDir ? t.videos.folderFound : null, status?.wcrCloud?.configured ? t.videos.cloud(status.wcrCloud.guild ?? '') : null].filter(Boolean).join(' · ') || t.videos.noFolder,
          <>
            <FolderForm api={VIDEOS_API} pickTitle={t.videos.pickTitle} placeholder="D:\WarcraftRecorder" detectedLabel={t.videos.detectedLabel} onSaved={reload} />
            {inTauri && <WcrCloudForm current={status?.wcrCloud ?? null} onSaved={reload} />}
          </>,
        )}
        {card(
          'discord',
          MessageSquare,
          'Discord',
          t.discord.desc,
          status?.discord?.webhook ? 'ok' : 'off',
          status?.discord?.webhook ? t.on : t.off,
          inTauri ? <DiscordForm current={status?.discord ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
        {card(
          'ai',
          Bot,
          t.ai.title,
          t.ai.desc,
          status?.ai ? 'ok' : 'off',
          status?.ai ? (aiPreset?.label ?? t.ai.configured) : t.ai.notConfigured,
          inTauri ? <AiForm current={status?.ai ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
      </SettingsGroup>

      <SettingsGroup title={t.groups.about}>
        {card(
          'about',
          Info,
          'Wipe Cause',
          t.about.desc,
          updateState.kind === 'available' ? 'todo' : 'info',
          updateState.kind === 'available' ? t.about.available(updateState.version) : appVersion ? `v${appVersion}` : t.about.browser,
          <About version={appVersion} state={updateState} onCheck={onCheckUpdates} />,
        )}
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <h2>
        {title}
        {hint && <span className="muted small">{hint}</span>}
      </h2>
      <div className="set-cards">{children}</div>
    </section>
  );
}

function SettingsCard({
  id,
  icon: Icon,
  title,
  desc,
  tone,
  label,
  open,
  onToggle,
  children,
}: {
  id: SettingsSection;
  icon: LucideIcon;
  title: string;
  desc: string;
  tone: Tone;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <article id={`set-${id}`} className={`set-card ${open ? 'open' : ''}`}>
      <button className="set-card-head" onClick={onToggle} aria-expanded={open} aria-controls={`set-${id}-body`}>
        <span className={`set-icon ${tone}`}>
          <Icon size={18} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="set-title">
          <strong>{title}</strong>
          <span className="muted small">{desc}</span>
        </span>
        <span className={`set-status ${tone}`}>
          {tone === 'ok' && <Check size={12} strokeWidth={2.5} aria-hidden />}
          {tone === 'todo' && <CircleAlert size={12} strokeWidth={2.5} aria-hidden />}
          {label}
        </span>
        <ChevronDown size={16} strokeWidth={1.5} className="set-chev" aria-hidden />
      </button>
      {open && (
        <div className="set-card-body" id={`set-${id}-body`}>
          {children}
        </div>
      )}
    </article>
  );
}

function OnlyInApp() {
  return <p className="muted small">{useMessages(settingsMsg).onlyInApp}</p>;
}

/** Idioma do app (vale na hora, para todas as telas). */
function LanguageSelect({ label }: { label: string }) {
  const locale = useLocale();
  return (
    <label className="set-lang">
      <span className="muted small">{label}</span>
      <select className="select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function About({ version, state, onCheck }: { version: string | null; state: UpdateState; onCheck: () => void }) {
  const t = useMessages(settingsMsg).about;
  const [rules, setRules] = useState<string | null>(null);
  useEffect(() => {
    rulesDir().then(setRules).catch(() => {});
  }, []);
  const label =
    state.kind === 'checking'
      ? t.checking
      : state.kind === 'none'
        ? t.latest
        : state.kind === 'available'
          ? t.availableLong(state.version)
          : state.kind === 'downloading'
            ? t.downloading
            : state.kind === 'error'
              ? state.message
              : null;
  return (
    <>
      <div className="set-kv">
        <span className="muted">{t.version}</span>
        <span className="tabular">{version ? `v${version}` : t.browserDev}</span>
      </div>
      {inTauri && (
        <div className="set-actions left">
          <button className="btn" onClick={onCheck} disabled={state.kind === 'checking' || state.kind === 'downloading'}>
            <RefreshCw size={14} strokeWidth={1.5} className={state.kind === 'checking' ? 'spin' : ''} aria-hidden /> {t.check}
          </button>
          {label && <span className={`small ${state.kind === 'error' ? 'bad' : 'muted'}`}>{label}</span>}
        </div>
      )}
      {rules && (
        <>
          <div className="set-kv">
            <span className="muted">{t.rules}</span>
            <code>{rules}</code>
          </div>
          <p className="muted small">{t.rulesNote()}</p>
          <div className="set-actions left">
            <button className="btn ghost" onClick={() => revealInExplorer(rules)}>
              <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> {t.reveal}
            </button>
          </div>
        </>
      )}
    </>
  );
}
