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
    return { dir: s.dir, warning: s.warning, found: `${s.files.length} combat log${s.files.length === 1 ? '' : 's'} na pasta` };
  },
};

const VIDEOS_API: FolderApi = {
  get: wcrGetDir,
  set: wcrSetDir,
  detect: wcrDetectDir,
  scan: async () => {
    await migrateWcrDir();
    const s = await wcrVideos();
    return { dir: s.dir, warning: s.warning, found: `${s.videos.length} vídeos de encontros encontrados` };
  },
};

/**
 * Tudo o que o app precisa, num lugar: o essencial (pasta de logs e combat log no jogo), o
 * padrão da análise e as integrações opcionais. Cada cartão mostra o status e abre o formulário.
 */
export function SettingsView({ focus, report, appVersion, updateState, onCheckUpdates, firstRun, onStart }: Props) {
  const { status, reload } = useSetup();
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
        <h1>Configurações</h1>
        <p className="muted">O essencial para analisar os logs e as integrações que você pode ligar quando quiser. Tudo fica salvo só neste PC.</p>
        {status && (
          <div className="set-summary">
            <span className={`set-chip ${logsMissing ? 'todo' : 'ok'}`}>
              {logsMissing ? <CircleAlert size={14} strokeWidth={2} aria-hidden /> : <Check size={14} strokeWidth={2} aria-hidden />}
              {logsMissing ? 'Falta a pasta de logs' : 'Essencial pronto'}
            </span>
            <span className="set-chip">
              <span className="tabular">
                {optional.done} de {optional.total}
              </span>{' '}
              integrações ligadas
            </span>
          </div>
        )}
      </header>
      <FirstSteps firstRun={firstRun} onStart={onStart} onOpen={openSection} />

      <SettingsGroup title="Essencial" hint="Sem isso não há o que analisar.">
        {card(
          'logs',
          FolderOpen,
          'Pasta de logs do WoW',
          'Onde o jogo grava os WoWCombatLog*.txt. A lista de “Nova análise” e o modo ao vivo leem daqui.',
          !status ? 'info' : logsMissing ? 'todo' : 'ok',
          !status ? '…' : logsMissing ? 'Falta configurar' : status.logsSource === 'detected' ? 'Detectada' : 'Configurada',
          <FolderForm api={LOGS_API} pickTitle="Pasta de logs do WoW (World of Warcraft\_retail_\Logs)" placeholder="C:\Program Files (x86)\World of Warcraft\_retail_\Logs" detectedLabel="instalação do WoW" onSaved={reload} />,
        )}
        {card(
          'game',
          Gamepad2,
          'Combat log no jogo',
          'O WoW só grava o log quando você pede, e os detalhes dependem do Advanced Combat Logging.',
          acl === 'on' ? 'ok' : acl === 'off' ? 'todo' : 'info',
          acl === 'on' ? 'Ligado no log aberto' : acl === 'off' ? 'Desligado no log aberto' : 'Confira no jogo',
          <ol className="small set-steps">
            <li>
              No jogo: <em>Opções → Rede → Advanced Combat Logging</em> ligado (uma vez só). Sem ele, HP, recap das mortes e posições ficam
              incompletos.
            </li>
            <li>
              Antes do primeiro pull da noite, digite <code>/combatlog</code> no chat (ou use um addon que liga sozinho na raid).
            </li>
            <li>O log vai para a pasta acima; depois é só abrir em “Nova análise” ou ligar o modo ao vivo.</li>
          </ol>,
        )}
      </SettingsGroup>

      <SettingsGroup title="Abrir com o WoW">
        {card(
          'startup',
          Power,
          'Abrir quando o WoW abrir',
          'O Wipe Cause fica na bandeja e aparece sozinho quando você abre o jogo.',
          status?.openWithWow ? 'ok' : 'off',
          status?.openWithWow ? 'Ligado' : 'Desligado',
          inTauri ? <StartupForm enabled={!!status?.openWithWow} onSaved={reload} /> : <OnlyInApp />,
        )}
      </SettingsGroup>

      <SettingsGroup title="Análise">
        {card(
          'analysis',
          Skull,
          'Corte de mortes',
          'Depois de algumas mortes o wipe já está decidido: dano, cura, erros e interrupts param de contar na N-ésima morte.',
          'info',
          cutoff === 0 ? 'Desligado' : `Após ${cutoff} morte${cutoff > 1 ? 's' : ''}`,
          <>
            <CutoffStepper
              value={cutoff}
              disabled={false}
              title="Padrão para logs novos. 0 = conta tudo."
              onChange={(n) => {
                setCutoff(n);
                saveDeathCutoff(n);
              }}
            />
            <p className="muted small">Vale para os próximos logs. Para mudar só o log aberto, use o contador no topo (ele reanalisa na hora).</p>
          </>,
        )}
      </SettingsGroup>

      <SettingsGroup title="Integrações" hint="Opcionais: cada uma liga um recurso a mais.">
        {card(
          'wcl',
          Trophy,
          'Warcraft Logs',
          'Abre as noites da guilda sem o log no PC, compara você com os top players da spec e mostra o parse de cada um.',
          status?.wcl?.configured ? 'ok' : 'off',
          status?.wcl?.user ? `Conectado: ${status.wcl.user.name}` : status?.wcl?.configured ? 'Conectado' : 'Não conectado',
          inTauri ? <WclApiForm current={status?.wcl ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
        {card(
          'videos',
          Video,
          'Vídeos do Warcraft Recorder',
          'Assista ao gatilho do wipe e a cada morte no vídeo do Warcraft Recorder — o seu e, com a nuvem, o de quem mais da guilda subiu.',
          status?.wcrDir || status?.wcrCloud?.configured ? 'ok' : 'off',
          [status?.wcrDir ? 'Pasta encontrada' : null, status?.wcrCloud?.configured ? `Nuvem: ${status.wcrCloud.guild}` : null].filter(Boolean).join(' · ') || 'Sem pasta',
          <>
            <FolderForm api={VIDEOS_API} pickTitle="Pasta de vídeos do Warcraft Recorder" placeholder="D:\WarcraftRecorder" detectedLabel="pasta do Warcraft Recorder" onSaved={reload} />
            {inTauri && <WcrCloudForm current={status?.wcrCloud ?? null} onSaved={reload} />}
          </>,
        )}
        {card(
          'discord',
          MessageSquare,
          'Discord',
          'Manda o resumo de cada pull para o canal da raid, sozinho no modo ao vivo ou pelo botão “Discord”.',
          status?.discord?.webhook ? 'ok' : 'off',
          status?.discord?.webhook ? 'Ligado' : 'Desligado',
          inTauri ? <DiscordForm current={status?.discord ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
        {card(
          'ai',
          Bot,
          'Perguntar à IA',
          'Tire dúvidas sobre o pull com um provedor gratuito (ou local). A IA recebe um dossiê da luta.',
          status?.ai ? 'ok' : 'off',
          status?.ai ? (aiPreset?.label ?? 'Configurada') : 'Não configurada',
          inTauri ? <AiForm current={status?.ai ?? null} onSaved={reload} /> : <OnlyInApp />,
        )}
      </SettingsGroup>

      <SettingsGroup title="Sobre">
        {card(
          'about',
          Info,
          'Wipe Cause',
          'Versão, atualizações e a pasta das regras de boss.',
          updateState.kind === 'available' ? 'todo' : 'info',
          updateState.kind === 'available' ? `v${updateState.version} disponível` : appVersion ? `v${appVersion}` : 'modo navegador',
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
  return <p className="muted small">Configurar integrações funciona só no app instalado (no navegador a UI é só de exemplo).</p>;
}

function About({ version, state, onCheck }: { version: string | null; state: UpdateState; onCheck: () => void }) {
  const [rules, setRules] = useState<string | null>(null);
  useEffect(() => {
    rulesDir().then(setRules).catch(() => {});
  }, []);
  const label =
    state.kind === 'checking'
      ? 'Procurando…'
      : state.kind === 'none'
        ? 'Você está na versão mais recente'
        : state.kind === 'available'
          ? `Versão ${state.version} disponível: instale pela faixa no topo`
          : state.kind === 'downloading'
            ? 'Baixando atualização…'
            : state.kind === 'error'
              ? state.message
              : null;
  return (
    <>
      <div className="set-kv">
        <span className="muted">Versão</span>
        <span className="tabular">{version ? `v${version}` : 'modo navegador (desenvolvimento)'}</span>
      </div>
      {inTauri && (
        <div className="set-actions left">
          <button className="btn" onClick={onCheck} disabled={state.kind === 'checking' || state.kind === 'downloading'}>
            <RefreshCw size={14} strokeWidth={1.5} className={state.kind === 'checking' ? 'spin' : ''} aria-hidden /> Procurar atualizações
          </button>
          {label && <span className={`small ${state.kind === 'error' ? 'bad' : 'muted'}`}>{label}</span>}
        </div>
      )}
      {rules && (
        <>
          <div className="set-kv">
            <span className="muted">Regras de boss</span>
            <code>{rules}</code>
          </div>
          <p className="muted small">
            Arquivos <code>.yaml</code> nesta pasta substituem as regras embutidas (mecânicas, dicas e quem deveria fazer o quê).
          </p>
          <div className="set-actions left">
            <button className="btn ghost" onClick={() => revealInExplorer(rules)}>
              <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> Mostrar no Explorador
            </button>
          </div>
        </>
      )}
    </>
  );
}
