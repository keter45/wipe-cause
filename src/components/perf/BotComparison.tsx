import { useEffect, useMemo, useState } from 'react';
import { Bot, Play, RotateCcw, X } from 'lucide-react';
import type { Pull } from '../../types';
import { mmss, num, shortName } from '../../lib/format';
import { detectCooldowns, outputPerSec, perfInsights, totalCpm, type Sample } from '../../lib/performance';
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
  const button = (
    <button className={`btn ${run ? '' : 'primary'}`} onClick={simulate} disabled={!available || busy} title={available ? undefined : t.appOnly}>
      {run ? <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />} {run ? t.again : t.simulate}
    </button>
  );

  if (!loaded) return null;
  return (
    <>
      <div className="panel setup-cta bot-cta">
        <Bot size={20} strokeWidth={1.5} className="muted" aria-hidden />
        <div>
          <h3>{t.ctaTitle(shortName(name))}</h3>
          {run ? (
            <RunInfo run={run} me={me} status={status} />
          ) : (
            <p className="muted small">
              {t.ctaText} {available && !status?.installed && t.firstDownload}
              {!available && <> {t.appOnly}</>}
            </p>
          )}
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
          {button}
        </div>
      </div>
      {run && <BotResult run={run} nightPulls={nightPulls} name={name} />}
    </>
  );
}

function RunInfo({ run, me, status }: { run: BotRun; me: Sample; status: SimcStatus | null }) {
  const t = useMessages(botMsg);
  const cur = status?.installed?.commit;
  const old = cur && cur !== run.commit && !['local', 'dev'].includes(cur) && !['local', 'dev'].includes(run.commit);
  const assumed = run.assumed.map((a) => t.assumed[a]);
  return (
    <>
      <p className="muted small">
        {t.simulatedPull(run.pullNumber, mmss(run.windowMs))} — {run.clean ? t.cleanPull : t.dirtyPull} · {t.when(fmtWhen(run.created))}
      </p>
      {run.pullStartMs !== me.pull.startMs && <p className="muted small">{t.otherPull(run.pullNumber)}</p>}
      {assumed.length > 0 && <p className="muted small">{t.assumedNote(assumed.join(', '))}</p>}
      {old && <p className="small warn">{t.oldSimc}</p>}
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
  if (!me || !ref) return <p className="muted small">{t.otherPull(run.pullNumber)}</p>;

  const [mo, ro] = [outputPerSec(me), outputPerSec(ref)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const insights = perfInsights(me, ref, cds);
  return (
    <>
      <p className="muted small perf-note">{t.caveat}</p>
      <div className="kpis">
        <Stat label={m.perSecondAlive(false)} mine={num(mo)} ref={num(ro)} sub={t.botValue} tone={diff <= -15 ? 'bad' : diff < -3 ? 'warn' : 'good'} extra={`${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%`} />
        <Stat label={m.timeAlive} mine={mmss(run.windowMs)} ref={mmss(run.windowMs)} sub={t.botValue} />
        <Stat label={m.cpm} mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref).toFixed(1)} sub={t.botValue} />
      </div>
      <p className="muted small">{t.dpsRange(num(run.dps.min), num(run.dps.max))}</p>

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
      <details className="bot-profile small">
        <summary>{t.profile}</summary>
        <p className="muted">
          {t.profileHint} {run.banner}
          {/^[0-9a-f]{7,40}$/.test(run.commit) && (
            <>
              {' · '}
              <a href="#" onClick={(e) => (e.preventDefault(), void openExternal(`https://github.com/simulationcraft/simc/tree/${run.commit}`))}>
                {t.source}
              </a>
            </>
          )}
        </p>
        <pre>{run.input}</pre>
      </details>
    </>
  );
}
