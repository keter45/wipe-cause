import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, NotebookPen, Play, Sparkles, Star, X } from 'lucide-react';
import { useNote } from '../lib/notes';
import { addMark, useMarks } from '../lib/marks';
import { PullMarks } from './PullMarks';
import { useWclParses } from '../lib/useWclParses';
import { BossName, Colored } from './Names';
import type { Pull } from '../types';
import { classColor, mmss, pct, shortName } from '../lib/format';
import { analyzePull, lowestBossHpAtEnd } from '../lib/verdict';
import { DeathList } from './DeathList';
import { Hint } from './ui/Hint';
import { Clamp } from './ui/Clamp';
import { decodeReplay } from '../lib/replay';
import { usePotentials } from '../lib/botRaid';
import { PlayersTable } from './PlayersTable';
import { EnemySpellsTable } from './EnemySpellsTable';
import { MechanicsView } from './MechanicsView';
import { InterruptsView } from './InterruptsView';
import { HealNotePanel } from './HealNotePanel';
import { openExternal, type WcrVideo } from '../lib/api';
import { SeekContext } from '../lib/wcr';
import { bossUrl, wclPullLabel } from '../lib/wcl';
import { PlayAt, VideoPanel } from './VideoPanel';
import { ShareMenu } from './share/ShareMenu';
import { ClipPullContext } from './ClipButton';
import { clipMoments } from '../lib/replayClip';
import { PullShareCard } from './share/PullCard';
import { AskView } from './AskView';
import { ErrorBoundary } from './ErrorBoundary';
import { PerformanceView } from './perf/PerformanceView';
import { SpellIcon } from './SpellIcon';
import { mechanicSpellId, mechanicSpellMap } from '../lib/spells';
import { pullPayload } from '../lib/discord';
import { scorePull } from '../lib/score';
import { meIn, useMode, useSoloCharacter, type AppMode } from '../lib/mode';
import { SoloPullView } from './SoloPullView';
import { FightReplay } from './FightReplay';
import { canLoadFull } from '../lib/fullReplay';
import { messagesOf, useMessages } from '../i18n';
import { pullMsg } from './PullView.i18n';
import { wipeCallText } from '../lib/wipeCall';

type Tab = 'me' | 'mechanics' | 'deaths' | 'interrupts' | 'healcds' | 'players' | 'perf' | 'spells' | 'replay' | 'ask';

/** Aba aberta por último em cada modo: continua nela ao trocar de pull ou voltar das Configurações. */
const lastTab: Record<AppMode, Tab> = { guild: 'deaths', solo: 'me' };


interface Props {
  pull: Pull;
  /** código do report da noite no Warcraft Logs */
  wclCode?: string;
  /** vídeo do Warcraft Recorder casado com o pull */
  /** POVs do pull (Warcraft Recorder: este PC e a nuvem da guilda) */
  povs?: WcrVideo[];
  /** pulls do mesmo boss na noite (contexto da IA) */
  nightPulls?: Pull[];
  /** regras do boss ajustadas: reanalisar o log aberto */
  onRulesChanged?: () => void;
  /** o relatório está ao vivo (versão nova da note começa no pull seguinte) */
  live?: boolean;
}

/** HP de um boss: no corte ("ignorar após N mortes"), se houver. */
const bossHpOf = (pull: Pull) => (b: Pull['bosses'][number]) => (pull.cutoffT != null ? b.hpPctAtCutoff ?? b.hpPct : b.hpPct);

/** guid -> classe (cores dos mini mapas). */
const classesOf = (p: Pull) => new Map(p.players.map((x) => [x.guid, x.class] as const));

/** Erro no pull (dados inesperados de um log) fica no pull: a lista e o resto do app seguem. */
export function PullView(props: Props) {
  return (
    <ErrorBoundary label={messagesOf(pullMsg).errorScope} resetKey={props.pull.id}>
      <PullViewInner {...props} />
    </ErrorBoundary>
  );
}

function PullViewInner({ pull, wclCode, povs, nightPulls, onRulesChanged, live = false }: Props) {
  const t = useMessages(pullMsg);
  useMarks(pull);
  const replayData = useMemo(() => decodeReplay(pull), [pull]);
  const mode = useMode();
  const chosen = useSoloCharacter();
  const solo = mode === 'solo';
  const [tabState, setTabState] = useState<Tab>(lastTab[mode]);
  // trocou de modo: volta para a última aba daquele modo ("Você" não existe no modo guilda)
  useEffect(() => setTabState(lastTab[mode]), [mode]);
  const tab: Tab = !solo && tabState === 'me' ? 'deaths' : tabState;
  // ▶ da note de CDs de cura: a aba Replay abre nesse instante; abrir o Replay pela aba começa do zero
  const [replayAt, setReplayAt] = useState(0);
  const setTab = (t: Tab) => {
    lastTab[mode] = t;
    setTabState(t);
    setReplayAt(0);
  };
  const replayFrom = canLoadFull(pull)
    ? (t: number) => {
        setTab('replay');
        setReplayAt(t);
      }
    : undefined;
  const [showVerdict, setShowVerdict] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  // POV escolhido (o primeiro é o deste PC, se houver)
  const [povIndex, setPovIndex] = useState(0);
  const video = povs?.[Math.min(povIndex, povs.length - 1)];
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
    setPovIndex(0);
    setSeekReq(null);
    setShowMinor(false);
  }, [pull.id]);
  const mechFailures = pull.mechanics.filter((m) => m.failures > 0).length;
  const verdict = analyzePull(pull);
  const bossHp = bossHpOf(pull);
  const call = wipeCallText(pull);
  // com call de wipe, o gatilho do título é o que levou a ela
  const callTrigger = call ? pull.wipeCall?.trigger : undefined;
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));
  // no resumo da try, só o que causou o wipe; o resto (erros graves e avisos) fica recolhido
  const main = verdict.findings.filter((f) => f.severity === 'wipe');
  const minor = verdict.findings.filter((f) => f.severity !== 'wipe');
  const deathCount = pull.deaths.filter((d) => !d.ignored).length;
  // abas por assunto: o que deu errado · quem jogou como · a luta · IA
  const tabGroups: { label: string; tabs: { key: Tab; label: string; count?: number }[] }[] = solo
    ? [
        {
          label: t.groups.you,
          tabs: [
            { key: 'me', label: t.tabs.me },
            { key: 'perf', label: t.tabs.perfSolo },
          ],
        },
        {
          label: t.groups.raid,
          tabs: [
            { key: 'deaths', label: t.tabs.deaths, count: deathCount },
            { key: 'mechanics', label: t.tabs.mechanics, count: pull.rulesFile ? mechFailures : undefined },
            { key: 'interrupts', label: t.tabs.interrupts },
            { key: 'players', label: t.tabs.players, count: pull.players.length },
          ],
        },
        { label: t.groups.fight, tabs: [{ key: 'replay', label: t.tabs.replay }, { key: 'spells', label: t.tabs.spells }] },
      ]
    : [
    {
      label: t.groups.happened,
      tabs: [
        { key: 'deaths', label: t.tabs.deaths, count: deathCount },
        { key: 'mechanics', label: t.tabs.mechanics, count: pull.rulesFile ? mechFailures : undefined },
        { key: 'interrupts', label: t.tabs.interrupts },
        { key: 'healcds', label: t.tabs.healCds },
      ],
    },
    {
      label: t.groups.who,
      tabs: [
        { key: 'players', label: t.tabs.players, count: pull.players.length },
        { key: 'perf', label: t.tabs.perf },
      ],
    },
    { label: t.groups.fight, tabs: [{ key: 'replay', label: t.tabs.replay }, { key: 'spells', label: t.tabs.spells }] },
      ];

  // os erros que levaram ao wipe (a causa e as falhas que mataram antes da cascata), para o clipe do Compartilhar
  const clipShare = useMemo(() => {
    const moments = clipMoments(pull);
    return moments.length ? { pull, moments } : null;
  }, [pull]);
  const clipCtx = useMemo(() => ({ pull, title: `Pull ${pull.pullNumber} · ${pull.encounterName}` }), [pull]);

  return (
    <ClipPullContext.Provider value={clipCtx}>
    <SeekContext.Provider value={seek}>
    <div className="pull-view">
      <div className="pull-header">
        <div className="pull-heading">
          <h2>
            <BossName encounterId={pull.encounterId} name={pull.encounterName} size={30} />
          </h2>
          <div className="pull-facts muted">
            {pull.difficultyName} · pull {pull.pullNumber} · {pull.startLocal.split(' ')[1]?.slice(0, 5)} · {t.fightLength(mmss(pull.durationMs))}
            {pull.incomplete && <span className="warn">{t.incomplete}</span>}
            {call ? (
              <span title={call.detail} className={call.possible ? '' : 'wipe-call'}>
                {' · '}
                {call.short}
                {!pull.success && t.bossAtEnd(pct(lowestBossHpAtEnd(pull)))}
              </span>
            ) : (
              pull.cutoffT != null && (
                <span title={t.cutoffTitle}>
                  {t.analyzedUntil(mmss(pull.cutoffT))}
                  {!pull.success && t.bossAtEnd(pct(lowestBossHpAtEnd(pull)))}
                </span>
              )
            )}
          </div>
        </div>
        <div className="pull-outcome">
          <div className={`pull-outcome-big ${pull.success ? 'kill' : 'wipe'}`}>{pull.success ? 'Kill' : 'Wipe'}</div>
          <div className="muted small">
            {t.deathsN(deathCount)}
            {!pull.success && lowestBossHpAtEnd(pull) != null && <> · {t.bossAt(pct(lowestBossHpAtEnd(pull)))}</>}
          </div>
          <div className="boss-hp-pills">
            {pull.bosses.map((b) => (
              <span key={b.guid} className="boss-hp-pill" title={`${b.name}: ${pct(bossHp(b))}`}>
                {b.name} <b className="tabular">{pct(bossHp(b))}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="pull-toolbar">
        <PullNote pull={pull} />
        <PullMarks pull={pull} />
        <span className="pull-actions">
          {video && (
            <button className="btn sm" onClick={() => (videoOpen ? setVideoOpen(false) : seek?.(0))}>
              {videoOpen ? <X size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
              {videoOpen ? t.closeVideo : povs && povs.length > 1 ? t.videoPovs(povs.length) : t.video(video.player ?? 'POV')}
            </button>
          )}
          {wclCode && (
            <button
              className="btn sm"
              onClick={() => openExternal(bossUrl(wclCode, pull))}
              title={t.wclTitle(wclPullLabel(pull))}
            >
              Warcraft Logs <span className="muted">{wclPullLabel(pull)}</span>
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </button>
          )}
          {(video || wclCode) && <span className="toolbar-divider" aria-hidden />}
          <ShareMenu discord={() => pullPayload(pull, wclCode)} clip={clipShare} card={(detail) => <PullShareCard pull={pull} detail={detail} />} name={t.shareName(pull.success ? 'Kill' : `Wipe ${pull.pullNumber}`, pull.encounterName, pull.difficultyName)} />
        </span>
      </div>

      {video && videoOpen && povs && (
        <VideoPanel povs={povs} video={video} onPov={(v) => setPovIndex(povs.indexOf(v))} seek={seekReq} onClose={() => setVideoOpen(false)} />
      )}

      {solo && (
        <p className="solo-raid small">
          <span className="muted">{t.raid}</span> {verdict.headline}{' '}
          <button className="link small" onClick={() => setShowVerdict(!showVerdict)} aria-expanded={showVerdict}>
            {showVerdict ? t.hide : t.why}
          </button>
        </p>
      )}
      {(!solo || showVerdict) && (
      <section className={`verdict ${pull.success ? 'kill' : 'wipe'}`}>
        <h3>{t.weighedMost}</h3>
        <p className="verdict-headline">
          {callTrigger ? (
            callTrigger.spellId != null && <SpellIcon spellId={callTrigger.spellId} size={18} />
          ) : (
            pull.trigger && <SpellIcon spellId={mechanicSpellId(pull, pull.trigger.key)} size={18} />
          )}
          <Colored text={verdict.headline} />
          {callTrigger ? <PlayAt t={callTrigger.t} seek={seek} label={t.seeTrigger} /> : pull.trigger && <PlayAt t={pull.trigger.t} seek={seek} label={t.seeTrigger} />}
        </p>
        {call && (
          <p className="small wipe-call-note">
            <span className={`sev-tag ${call.possible ? 'minor' : 'none'}`}>{call.possible ? t.callPossibleTag : t.callTag}</span> {call.explain}
          </p>
        )}
        {main.length > 0 && (
          <ul className="findings">
            {main.map((f, i) => (
              <Finding key={i} f={f} pull={pull} decisive={verdict.decisiveDeaths} />
            ))}
          </ul>
        )}
        {minor.length > 0 && (
          <>
            <button className="link small more-toggle" onClick={() => setShowMinor(!showMinor)} aria-expanded={showMinor}>
              <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showMinor ? 'open' : ''}`} aria-hidden />
              {t.minor(showMinor, minor.length)}
            </button>
            {showMinor && (
              <ul className="findings minor">
                {minor.map((f, i) => (
                  <Finding key={i} f={f} pull={pull} decisive={verdict.decisiveDeaths} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      )}

      <div className="tabs" role="tablist" aria-label={t.tabsAria}>
        {tabGroups.map((g) => (
          <div key={g.label} className="tab-group" role="presentation" aria-label={g.label}>
            {g.tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                {t.label}
                {t.count != null && <span className="tab-count">{t.count}</span>}
              </button>
            ))}
          </div>
        ))}
        <span className="topbar-spacer" />
        <button role="tab" aria-selected={tab === 'ask'} className={`tab-ask ${tab === 'ask' ? 'active' : ''}`} onClick={() => setTab('ask')}>
          <Sparkles size={14} strokeWidth={1.5} aria-hidden /> {t.tabs.ask}
        </button>
      </div>

      {/* erro numa aba fica na aba: as outras e o resto do pull continuam */}
      <ErrorBoundary
        label={t.tabScope(tab === 'ask' ? t.tabs.ask : (tabGroups.flatMap((g) => g.tabs).find((x) => x.key === tab)?.label ?? ''))}
        resetKey={`${pull.id}:${tab}`}
      >
      {tab === 'mechanics' && <MechanicsView pull={pull} onRulesChanged={onRulesChanged} />}
      {tab === 'deaths' && (
        <DeathList
          deaths={pull.deaths}
          decisive={decisive}
          cutoffT={pull.cutoffT ?? null}
          wipeCall={pull.wipeCall}
          classes={classesOf(pull)}
          mechanicSpells={mechanicSpellMap([pull])}
          replayData={replayData}
          onMark={(d) =>
            addMark(pull, {
              guid: d.guid,
              name: d.name,
              what: t.diedTo(d.killingBlowMechanic ?? d.killingBlow?.spellName ?? t.damage),
              severity: 'major',
              t: d.t,
              spellId: d.killingBlow?.spellId ?? null,
            })
          }
        />
      )}
      {tab === 'interrupts' && <InterruptsView pull={pull} nightPulls={nightPulls ?? [pull]} live={live} />}
      {tab === 'healcds' && <HealNotePanel key={pull.id} pulls={nightPulls ?? [pull]} focus={pull} live={live} onReplay={replayFrom} />}
      {tab === 'players' && <PlayersTab pull={pull} nightPulls={nightPulls ?? [pull]} wclCode={wclCode} />}
      {tab === 'me' && <SoloPullView pull={pull} nightPulls={nightPulls ?? [pull]} />}
      {tab === 'perf' && <PerformanceView pull={pull} nightPulls={nightPulls ?? [pull]} wclCode={wclCode} defaultGuid={solo ? meIn(pull, chosen)?.guid : undefined} solo={solo && !!meIn(pull, chosen)} />}
      {tab === 'spells' && <EnemySpellsTable pull={pull} onRulesChanged={onRulesChanged} />}
      {tab === 'replay' && <FightReplay key={`${pull.logFile ?? ''}:${pull.logOffset ?? ''}:${pull.startMs}:${pull.id}`} pull={pull} startAt={replayAt} />}
      {tab === 'ask' && <AskView pull={pull} nightPulls={nightPulls ?? [pull]} />}
      </ErrorBoundary>
    </div>
    </SeekContext.Provider>
    </ClipPullContext.Provider>
  );
}

/** Aba Jogadores: nota do app + parse do Warcraft Logs (DPS para dps, HPS para healers). */
function PlayersTab({ pull, nightPulls, wclCode }: { pull: Pull; nightPulls: Pull[]; wclCode?: string }) {
  const parseState = useWclParses(pull, wclCode);
  const potentials = usePotentials(nightPulls, pull);
  return <PlayersTable players={pull.players} scores={scorePull(pull)} parseState={parseState} pull={pull} potentials={potentials} />;
}

/** Anotação livre do pull (a mesma do aviso do modo ao vivo). */
function PullNote({ pull }: { pull: Pull }) {
  const [note, setNote] = useNote(pull);
  const t = useMessages(pullMsg);
  return (
    <label className="pull-note">
      <NotebookPen size={14} strokeWidth={1.5} className="muted" aria-hidden />
      <input
        className="text-input"
        value={note}
        placeholder={pull.success ? t.notePlaceholderKill : t.notePlaceholderWipe}
        aria-label={t.noteAria}
        onChange={(e) => setNote(e.target.value)}
      />
    </label>
  );
}

type FindingT = ReturnType<typeof analyzePull>['findings'][number];
type Who = { key: string; name: string; cls: string | null; x: string };

/** Quem o achado envolve, dos mesmos dados que o verdict leu: os players da mecânica, ou as mortes que ele agrupa. */
function whoOf(f: FindingT, pull: Pull, decisive: Pull['deaths']): Who[] {
  if (f.spellId == null) return [];
  const cls = (guid: string) => pull.players.find((p) => p.guid === guid)?.class ?? null;
  const m = pull.mechanics.find((x) => x.spellId === f.spellId && x.failures > 0);
  const blamed = m ? m.players.filter((x) => !x.credit) : [];
  if (blamed.length) return [...blamed].sort((a, b) => b.count - a.count).map((x) => ({ key: x.guid, name: shortName(x.name), cls: cls(x.guid), x: `${x.incidents ?? x.count}×` }));
  const ds = decisive.filter((d) => d.killingBlow?.spellId === f.spellId);
  return ds.length >= 2 ? ds.map((d) => ({ key: `${d.guid}:${d.t}`, name: shortName(d.name), cls: d.class ?? cls(d.guid), x: mmss(d.t) })) : [];
}

/** Uma linha do que pesou: ícone, o achado, quem (cor da classe, quantas vezes) e quantos jogadores à direita. */
function Finding({ f, pull, decisive }: { f: FindingT; pull: Pull; decisive: Pull['deaths'] }) {
  const t = useMessages(pullMsg);
  const who = whoOf(f, pull, decisive);
  const shown = who.slice(0, 6);
  const people = new Set(who.map((w) => w.name)).size;
  return (
    <li className={`finding ${f.severity}`}>
      {f.spellId != null ? <SpellIcon spellId={f.spellId} size={36} /> : <span className={`finding-dot ${f.severity}`} title={t.severity[f.severity]} />}
      <div className="finding-body">
        <div className="finding-title">
          {f.focus && (
            <span className="focus-mark" title={t.focus}>
              <Star size={14} strokeWidth={1.75} fill="currentColor" aria-label={t.focusMark} />
            </span>
          )}
          <strong>
            <Colored text={f.title} plainStart={f.spellId != null} />
          </strong>
          {f.tip && (
            <Hint>
              <Colored text={f.tip} />
            </Hint>
          )}
        </div>
        {shown.length > 0 ? (
          <div className="finding-who">
            {shown.map((w) => (
              <span key={w.key} className="who-chip" style={{ color: classColor(w.cls) }}>
                {w.name} <span className="muted">{w.x}</span>
              </span>
            ))}
            {who.length > shown.length && <span className="who-chip muted">+{who.length - shown.length}</span>}
          </div>
        ) : (
          f.detail && (
            <Clamp className="finding-detail muted small">
              <Colored text={f.detail} />
            </Clamp>
          )
        )}
      </div>
      {people > 0 && (
        <div className="finding-count">
          {people}
          <span className="muted small">{t.players(people)}</span>
        </div>
      )}
    </li>
  );
}
