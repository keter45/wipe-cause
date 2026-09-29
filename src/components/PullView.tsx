import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Play, X } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { analyzePull, lowestBossHpAtEnd } from '../lib/verdict';
import { DeathList } from './DeathList';
import { PlayersTable } from './PlayersTable';
import { EnemySpellsTable } from './EnemySpellsTable';
import { MechanicsView } from './MechanicsView';
import { InterruptsView } from './InterruptsView';
import { openExternal, type WcrVideo } from '../lib/api';
import { SeekContext } from '../lib/wcr';
import { bossUrl, wclPullLabel } from '../lib/wcl';
import { PlayAt, VideoPanel } from './VideoPanel';
import { SendToDiscord } from './SendToDiscord';
import { ShareMenu } from './ShareMenu';
import { PullShareCard } from './ShareCards';
import { AskView } from './AskView';
import { PerformanceView } from './PerformanceView';
import { SpellIcon } from './SpellIcon';
import { mechanicSpellId, mechanicSpellMap } from '../lib/spells';
import { pullPayload } from '../lib/discord';
import { scorePull } from '../lib/score';

type Tab = 'mechanics' | 'deaths' | 'interrupts' | 'players' | 'perf' | 'spells' | 'ask';

const SEVERITY_LABEL = { wipe: 'Causa', major: 'Grave', minor: 'Atenção', info: 'Info' } as const;

interface Props {
  pull: Pull;
  /** código do report da noite no Warcraft Logs */
  wclCode?: string;
  /** vídeo do Warcraft Recorder casado com o pull */
  video?: WcrVideo;
  /** pulls do mesmo boss na noite (contexto da IA) */
  nightPulls?: Pull[];
}

/** HP de um boss: no corte ("ignorar após N mortes"), se houver. */
const bossHpOf = (pull: Pull) => (b: Pull['bosses'][number]) => (pull.cutoffT != null ? b.hpPctAtCutoff ?? b.hpPct : b.hpPct);

/** guid -> classe (cores dos mini mapas). */
const classesOf = (p: Pull) => new Map(p.players.map((x) => [x.guid, x.class] as const));

export function PullView({ pull, wclCode, video, nightPulls }: Props) {
  const [tab, setTab] = useState<Tab>('deaths');
  const [videoOpen, setVideoOpen] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  const [seekReq, setSeekReq] = useState<{ t: number; n: number } | null>(null);
  const seek = video
    ? (t: number) => {
        setSeekReq((prev) => ({ t, n: (prev?.n ?? 0) + 1 }));
        setVideoOpen(true);
      }
    : null;
  // outro pull: fecha o vídeo e recolhe os avisos
  useEffect(() => {
    setVideoOpen(false);
    setSeekReq(null);
    setShowMinor(false);
  }, [pull.id]);
  const mechFailures = pull.mechanics.filter((m) => m.failures > 0).length;
  const verdict = analyzePull(pull);
  const bossHp = bossHpOf(pull);
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));
  // causas e problemas graves sempre visíveis; avisos menores recolhidos
  const main = verdict.findings.filter((f) => f.severity === 'wipe' || f.severity === 'major');
  const minor = verdict.findings.filter((f) => f.severity === 'minor' || f.severity === 'info');
  const deathCount = pull.deaths.filter((d) => !d.ignored).length;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'mechanics', label: 'Mecânicas', count: pull.rulesFile ? mechFailures : undefined },
    { key: 'deaths', label: 'Mortes', count: deathCount },
    { key: 'interrupts', label: 'Interrupts' },
    { key: 'players', label: 'Jogadores', count: pull.players.length },
    { key: 'perf', label: 'Desempenho' },
    { key: 'spells', label: 'Habilidades do boss' },
    { key: 'ask', label: 'Perguntar à IA' },
  ];

  return (
    <SeekContext.Provider value={seek}>
    <div className="pull-view">
      <div className="pull-header">
        <div>
          <h2>
            {pull.encounterName} <span className="muted">· {pull.difficultyName} · pull {pull.pullNumber}</span>
          </h2>
          <div className="muted">
            {pull.startLocal.split(' ')[1]?.slice(0, 8)} · {mmss(pull.durationMs)}
            {pull.incomplete && <span className="warn"> · log terminou antes do fim do encontro</span>}
            {pull.cutoffT != null && (
              <span title="Ignorar eventos após N mortes: dano, cura, erros e falhas contam só até aqui">
                {' '}
                · analisado até {mmss(pull.cutoffT)}
                {!pull.success && ` (no fim do pull o boss estava em ${pct(lowestBossHpAtEnd(pull))})`}
              </span>
            )}
          </div>
          {wclCode && (
            <button
              className="btn sm"
              onClick={() => openExternal(bossUrl(wclCode, pull))}
              title={`Abre o report filtrado neste boss; a try é a "${wclPullLabel(pull)}" da lista`}
            >
              Warcraft Logs <span className="muted">{wclPullLabel(pull)}</span>
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
          {video && (
            <button className="btn sm" onClick={() => (videoOpen ? setVideoOpen(false) : seek?.(0))}>
              {videoOpen ? <X size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
              {videoOpen ? 'Fechar vídeo' : `Vídeo (${video.player ?? 'POV'})`}
            </button>
          )}
          <SendToDiscord payload={() => pullPayload(pull, wclCode)} />
          <ShareMenu card={() => <PullShareCard pull={pull} />} name={`${pull.success ? 'Kill' : `Wipe ${pull.pullNumber}`} - ${pull.encounterName} ${pull.difficultyName}`} />
        </div>
        <div className="boss-bars">
          {pull.bosses.map((b) => (
            <div key={b.guid} className="boss-bar" title={`${b.name}: ${pct(bossHp(b))}`}>
              <div className="boss-bar-fill" style={{ width: `${bossHp(b) ?? 0}%` }} />
              <span>
                {b.name} {pct(bossHp(b))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {video && videoOpen && <VideoPanel video={video} seek={seekReq} onClose={() => setVideoOpen(false)} />}

      <section className={`verdict ${pull.success ? 'kill' : 'wipe'}`}>
        <h3>
          {pull.trigger && <SpellIcon spellId={mechanicSpellId(pull, pull.trigger.key)} size={20} />}
          {verdict.headline}
          {pull.trigger && <PlayAt t={pull.trigger.t} seek={seek} label="ver gatilho" />}
        </h3>
        {main.length > 0 && (
          <ul className="findings">
            {main.map((f, i) => (
              <Finding key={i} f={f} />
            ))}
          </ul>
        )}
        {minor.length > 0 && (
          <>
            <button className="link small more-toggle" onClick={() => setShowMinor(!showMinor)} aria-expanded={showMinor}>
              <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showMinor ? 'open' : ''}`} aria-hidden />
              {showMinor ? 'Esconder' : 'Mostrar'} {minor.length} aviso{minor.length > 1 ? 's' : ''} menor{minor.length > 1 ? 'es' : ''}
            </button>
            {showMinor && (
              <ul className="findings minor">
                {minor.map((f, i) => (
                  <Finding key={i} f={f} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count != null && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'mechanics' && <MechanicsView pull={pull} />}
      {tab === 'deaths' && <DeathList deaths={pull.deaths} decisive={decisive} cutoffT={pull.cutoffT ?? null} classes={classesOf(pull)} mechanicSpells={mechanicSpellMap([pull])} />}
      {tab === 'interrupts' && <InterruptsView pull={pull} />}
      {tab === 'players' && <PlayersTable players={pull.players} scores={scorePull(pull)} />}
      {tab === 'perf' && <PerformanceView pull={pull} nightPulls={nightPulls ?? [pull]} wclCode={wclCode} />}
      {tab === 'spells' && <EnemySpellsTable spells={pull.enemySpells} />}
      {tab === 'ask' && <AskView pull={pull} nightPulls={nightPulls ?? [pull]} />}
    </div>
    </SeekContext.Provider>
  );
}

function Finding({ f }: { f: ReturnType<typeof analyzePull>['findings'][number] }) {
  return (
    <li className={`finding ${f.severity}`}>
      <span className="badge">{SEVERITY_LABEL[f.severity]}</span>
      <span>
        {f.spellId != null && <SpellIcon spellId={f.spellId} size={18} />}
        <strong>{f.title}</strong>
        {f.detail && <span className="muted"> — {f.detail}</span>}
      </span>
    </li>
  );
}
