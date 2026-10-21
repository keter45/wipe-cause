import { useEffect, useMemo, useState } from 'react';
import { Bot, Play, RotateCcw, X } from 'lucide-react';
import type { Pull } from '../../types';
import { mmss, shortName } from '../../lib/format';
import { detectCooldowns, perfInsights, totalCpm, type Sample } from '../../lib/performance';
import { BOT_ITERATIONS, botMe, botSample, loadBotRun, NoPullError, runBot, type BotRun, type BotStep } from '../../lib/botSim';
import { openExternal, simcCancel, simcStatus, type SimcStatus } from '../../lib/api';
import { messagesOf, useMessages } from '../../i18n';
import { botMsg } from './bot.i18n';
import { perfViewMsg } from './perf.i18n';
import { soloPullMsg } from '../SoloPullView.i18n';
import { SpellIcon } from '../SpellIcon';
import { Colored, useMentionsSpell } from '../Names';
import { Hint } from '../ui/Hint';
import { Stat, Bursts, Rotation, Potions } from './sections';
import { CooldownCompare } from './CooldownCompare';
import { Advantage } from './Advantage';
import { specLabel } from '../../lib/specs';
import { decisionRefFor } from '../../lib/bench';
import { botDecisions, findingKey, type BotDecisions, type TopsDiff, type TopsNote } from '../../lib/botDecisions';
import { fixes, potential } from '../../lib/botView';
import { DecisionCards, PotentialGauge, SimSheet, TOP_FIXES, TopFixes, fixCost } from './BotParts';

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** "Comparar com o robô": simula o player com o SimulationCraft e compara como com um top. */
export function BotComparison({ me, nightPulls }: { me: Sample; nightPulls: Pull[] }) {
  const t = useMessages(botMsg);
  const name = me.player.name;
  const [status, setStatus] = useState<SimcStatus | null>(null);
  const [run, setRun] = useState<BotRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<{ s: BotStep; progress?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setRun(null);
    setError(null);
    simcStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    loadBotRun(me.pull, name)
      .then((r) => alive && setRun(r))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [me.pull, name]);

  async function simulate() {
    setError(null);
    setStep({ s: 'profile' });
    try {
      setRun(await runBot(nightPulls, me.pull, name, (s, progress) => setStep({ s, progress })));
      setStatus(await simcStatus().catch(() => status));
    } catch (e) {
      setError(e instanceof NoPullError ? t.noPull : t.failed(e instanceof Error ? e.message : String(e)));
    } finally {
      setStep(null);
    }
  }

  const available = status?.available ?? false;
  const busy = step != null;
  const stepText = !step
    ? null
    : step.s === 'profile'
      ? t.stepProfile
      : step.s === 'sequence'
        ? t.stepSequence
        : step.progress != null && step.progress < 1
          ? t.stepDownload(Math.round(step.progress * 100))
          : t.stepSimulating(BOT_ITERATIONS);
  const cur = status?.installed?.commit;
  const old = !!run && !!cur && cur !== run.commit && !['local', 'dev'].includes(cur) && !['local', 'dev'].includes(run.commit);

  if (!loaded) return null;
  return (
    <>
      <div className="panel setup-cta bot-cta">
        <Bot size={20} strokeWidth={1.5} className="muted" aria-hidden />
        <div>
          <h3>{t.ctaTitle(shortName(name))}</h3>
          {!run && (
            <p className="muted small">
              {t.ctaText} {available && !status?.installed && t.firstDownload}
              {!available && <> {t.appOnly}</>}
            </p>
          )}
          {run && run.pullStartMs !== me.pull.startMs && <p className="muted small">{t.otherPull(run.pullNumber)}</p>}
          {old && <p className="small warn">{t.oldSimc}</p>}
          {stepText && (
            <p className="small bot-step" role="status">
              {stepText}
            </p>
          )}
          {error && <p className="small bad">{error}</p>}
        </div>
        <div className="bot-actions">
          {busy && step?.s !== 'profile' && (
            <button className="btn" onClick={() => void simcCancel()}>
              <X size={14} strokeWidth={1.5} aria-hidden /> {t.cancel}
            </button>
          )}
          <button className={`btn ${run ? '' : 'primary'}`} onClick={simulate} disabled={!available || busy} title={available ? undefined : t.appOnly}>
            {run ? <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />} {run ? t.again : t.simulate}
          </button>
        </div>
      </div>
      {run && <BotResult run={run} nightPulls={nightPulls} name={name} />}
    </>
  );
}

/** Chips de quando e com qual SimC (o código-fonte do commit, GPL-3). */
function RunChips({ run }: { run: BotRun }) {
  const t = useMessages(botMsg);
  const version = /SimulationCraft (\d\S*)/.exec(run.banner)?.[1];
  return (
    <>
      <span className="bot-chip">{t.when(fmtWhen(run.created))}</span>
      {version && (
        <span className="bot-chip" title={run.banner}>
          SimC {version}
          {/^[0-9a-f]{7,40}$/.test(run.commit) && (
            <a href="#" onClick={(e) => (e.preventDefault(), void openExternal(`https://github.com/simulationcraft/simc/tree/${run.commit}`))}>
              {t.source}
            </a>
          )}
        </span>
      )}
    </>
  );
}

function BotResult({ run, nightPulls, name }: { run: BotRun; nightPulls: Pull[]; name: string }) {
  const t = useMessages(botMsg);
  const m = messagesOf(perfViewMsg);
  const mentions = useMentionsSpell();
  const me = useMemo(() => botMe(nightPulls, run, name) ?? null, [nightPulls, run, name]);
  const ref = useMemo(() => (me ? botSample(me, run) : null), [me, run]);
  const cds = useMemo(() => (me && ref ? detectCooldowns([me, ref]) : new Map()), [me, ref]);
  const d: BotDecisions | null = useMemo(() => (me ? botDecisions(me, run, decisionRefFor(me.player)) : null), [me, run]);
  if (!me || !ref) return <p className="muted small">{t.otherPull(run.pullNumber)}</p>;

  const pot = potential(me, run);
  const insights = perfInsights(me, ref, cds);
  const notes = d ? Object.fromEntries(Object.entries(d.topsNotes).map(([k, n]) => [k, noteText(n)])) : {};
  const fixList = d ? fixes(me, run, d, findingKey) : [];
  return (
    <>
      <SimSheet run={run} me={me} extra={<RunChips run={run} />} />
      <div className="bot-top">
        {pot && <PotentialGauge p={pot} />}
        <div className="kpis">
          <Stat label={m.timeAlive} mine={mmss(run.windowMs)} ref={mmss(run.windowMs)} sub={t.botValue} />
          <Stat label={m.cpm} mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref).toFixed(1)} sub={t.botValue} />
        </div>
      </div>

      <TopFixes list={fixList} windowMs={run.windowMs} notes={notes} />
      <BotDecisionsView me={me} d={d} notes={notes} costs={new Map(fixList.map((f) => [f.key, fixCost(f, run.windowMs)]))} shown={new Set(fixList.slice(0, TOP_FIXES).map((f) => f.key))} />

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>{m.keyPoints}</h4>
          <ul className="perf-insights">
            {insights.map((i, k) => (
              <li key={k} className={`tone-${i.tone}`}>
                {i.spellId != null && !mentions(i.text) && <SpellIcon spellId={i.spellId} size={16} />}
                <Colored text={i.text} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="perf-section">
        <h4>
          {messagesOf(soloPullMsg).advantage} <Hint>{messagesOf(soloPullMsg).alignedHint}</Hint>
        </h4>
        <Advantage me={me} ref_={ref} refLabel={t.bot} unit="DPS" casts />
      </section>
      <Bursts me={me} ref_={ref} cds={cds} />
      <CooldownCompare me={me} ref_={ref} cds={cds} />
      <Rotation me={me} ref_={ref} cds={cds} />
      <Potions me={me} ref_={ref} />
    </>
  );
}

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

function noteText(n: TopsNote): string {
  const t = messagesOf(botMsg).topsNote;
  switch (n.kind) {
    case 'agree_you':
      return t.agree_you(n.spell);
    case 'lose':
      return t.lose(Math.round(n.pct * 100));
    case 'hold':
      return t.hold(secs(n.ms));
    case 'no_align':
      return t.no_align(n.partner);
  }
}

function diffText(d: TopsDiff): string {
  const t = messagesOf(botMsg);
  switch (d.kind) {
    case 'consumers':
      return t.diffConsumers(d.name, d.bot.join(', '), d.tops.join(', '));
    case 'held':
      return t.diffHeld(d.name, secs(d.bot), secs(d.tops));
    case 'align':
      return (d.who === 'tops' ? t.diffAlignTops : t.diffAlignBot)(d.name, d.partnerName, Math.round(d.share * 100));
  }
}

/** Procs, cooldowns e o cast a cast contra as 20 lutas do robô, e onde os tops fazem diferente. */
function BotDecisionsView({ me, d, notes, costs, shown }: { me: Sample; d: BotDecisions | null; notes: Record<string, string>; costs: Map<string, string>; shown: Set<string> }) {
  const t = useMessages(botMsg);
  if (!d) return <p className="muted small">{t.needsRotation(specLabel(me.player.specId))}</p>;
  // os que já estão em "o que mudar primeiro" não se repetem
  const rest = [...d.choices, ...d.findings].filter((x) => !shown.has(findingKey(x)));
  const empty = d.findings.length === 0 && d.choices.length === 0;
  return (
    <>
      {(empty || rest.length > 0) && (
        <section className="perf-section">
          <h4>
            {shown.size ? t.moreDecisions : t.decisions} <Hint>{`${t.decisionsHint} ${t.choicesHint}`}</Hint>
          </h4>
          {empty ? <p className="muted small">{t.noDecisions}</p> : <DecisionCards items={rest} notes={notes} costs={costs} />}
        </section>
      )}
      {d.topsDiffs.length > 0 && (
        <section className="perf-section">
          <h4>
            {t.topsTitle} <Hint>{t.topsHint}</Hint>
          </h4>
          <ul className="plain bench-list small">
            {d.topsDiffs.map((x, i) => (
              <li key={i}>
                <Colored text={diffText(x)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
