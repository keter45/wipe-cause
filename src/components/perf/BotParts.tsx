import { FlaskConical, Gem, UtensilsCrossed, Check, CircleAlert, CircleHelp, User } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BotRun } from '../../lib/botSim';
import type { BotChoice } from '../../lib/botDecisions';
import { findingKey } from '../../lib/botDecisions';
import type { DecisionFinding } from '../../lib/decisions';
import type { Sample } from '../../lib/performance';
import { raceName, simFacts, type Fix, type Have, type Potential, type SimFacts } from '../../lib/botView';
import { mmss, num, uniqueSeconds } from '../../lib/format';
import { useSeek } from '../../lib/wcr';
import { messagesOf, useMessages } from '../../i18n';
import { botMsg } from './bot.i18n';
import { SpellIcon } from '../SpellIcon';
import { PlayAt } from '../VideoPanel';
import { Hint } from '../ui/Hint';

const BLOODLUST = 2825;
const POWER_INFUSION = 10060;
const LUST_MS = 40_000;
const PI_MS = 15_000;

const pctOf = (ms: number, total: number) => `${Math.max(0, Math.min(100, (ms / Math.max(1, total)) * 100))}%`;

// ---------------------------------------------------------------- ficha da simulação

/** O que o robô jogou: pull, linha do tempo da luta, consumíveis, buffs da raide e personagem. */
export function SimSheet({ run, me, extra }: { run: BotRun; me: Sample; extra?: ReactNode }) {
  const t = useMessages(botMsg).sheet;
  const f = simFacts(run);
  return (
    <section className="bot-sheet panel">
      <div className="bot-chips">
        <h4>
          {t.title} <Hint>{t.hint}</Hint>
        </h4>
        <span className={`bot-chip ${run.kill || run.clean ? 'have-had' : 'have-default'}`} title={run.clean ? undefined : t.diedHint}>
          {run.kill || run.clean ? <Check size={12} aria-hidden /> : <CircleAlert size={12} aria-hidden />} {t.pull(run.pullNumber, mmss(run.windowMs))}
          {run.kill && ` · ${t.kill}`}
          {run.clean ? !run.kill && ` · ${t.alive}` : ` · ${t.died}`}
        </span>
        {extra}
      </div>
      <Timeline f={f} />
      <div className="bot-rows">
        <Row label={t.consumables}>
          {f.consumables.map((c) => (
            <HaveChip key={c.kind} have={c.have} title={t.have[c.have]}>
              {c.kind === 'flask' ? <FlaskConical size={12} aria-hidden /> : c.kind === 'food' ? <UtensilsCrossed size={12} aria-hidden /> : <Gem size={12} aria-hidden />} {t.kinds[c.kind]}
            </HaveChip>
          ))}
        </Row>
        <Row label={t.raidBuffs}>
          {f.raidBuffs.map((b) => (
            <HaveChip key={b.key} have={b.on ? 'had' : 'missing'} title={b.on ? t.on : t.off}>
              <SpellIcon spellId={b.spellId} size={14} /> {b.name}
            </HaveChip>
          ))}
        </Row>
        <Row label={t.character}>
          {me.player.setup && <span className="bot-chip">ilvl {me.player.setup.itemLevel.toFixed(0)}</span>}
          {f.race && (
            <HaveChip have={f.raceGuessed ? 'default' : 'had'} title={f.raceGuessed ? t.raceGuessed : undefined}>
              <User size={12} aria-hidden /> {raceName(f.race)}
            </HaveChip>
          )}
          {me.player.rotation?.tree && <span className="bot-chip">{me.player.rotation.tree}</span>}
        </Row>
      </div>
      <details className="bot-profile small">
        <summary>{t.profile}</summary>
        <pre>{run.input}</pre>
      </details>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bot-row">
      <span className="bot-row-label muted small">{label}</span>
      <div className="bot-row-chips">{children}</div>
    </div>
  );
}

function HaveChip({ have, title, children }: { have: Have; title?: string; children: ReactNode }) {
  const icon = have === 'default' ? <CircleHelp size={11} aria-hidden /> : null;
  return (
    <span className={`bot-chip have-${have}`} title={title}>
      {children}
      {icon}
    </span>
  );
}

/** Junta, para desenhar, janelas de adds a menos de 4s uma da outra (fica o maior número). */
function mergeNear(adds: SimFacts['adds']): SimFacts['adds'] {
  const out: SimFacts['adds'] = [];
  for (const a of [...adds].sort((x, y) => x.from - y.from)) {
    const last = out[out.length - 1];
    if (last && a.from - last.to < 4000) {
      last.to = Math.max(last.to, a.to);
      last.count = Math.max(last.count, a.count);
    } else out.push({ ...a });
  }
  return out;
}

/** A luta do robô em faixas: buffs de fora, alvos, movimento e a vida do boss. */
function Timeline({ f }: { f: SimFacts }) {
  const t = useMessages(botMsg).sheet;
  const total = f.durationMs;
  const bar = (from: number, dur: number) => ({ left: pctOf(from, total), width: pctOf(Math.min(dur, total - from), total) });
  return (
    <div className="bot-tl" role="img" aria-label={t.title}>
      <span className="bot-tl-label muted small">{t.buffs}</span>
      <div className="bot-track">
        {f.lust != null && (
          <span className="bot-bar lust" style={bar(f.lust, LUST_MS)} title={`Bloodlust ${mmss(f.lust)}`}>
            <SpellIcon spellId={BLOODLUST} size={12} /> Bloodlust
          </span>
        )}
        {f.pi.map((at) => (
          <span key={at} className="bot-bar pi" style={bar(at, PI_MS)} title={`Power Infusion ${mmss(at)}`}>
            <SpellIcon spellId={POWER_INFUSION} size={12} />
          </span>
        ))}
      </div>
      <span className="bot-tl-label muted small">{t.targets}</span>
      <div className="bot-track">
        {mergeNear(f.adds).map((a) => (
          <span key={a.from} className="bot-bar adds" style={bar(a.from, a.to - a.from)} title={`${mmss(a.from)}–${mmss(a.to)}: ${a.count + 1}`}>
            +{a.count}
          </span>
        ))}
        {f.noTarget.map((a) => (
          <span key={a.from} className="bot-bar idle" style={bar(a.from, a.to - a.from)} title={`${mmss(a.from)}–${mmss(a.to)}`}>
            {t.noTarget}
          </span>
        ))}
      </div>
      <span className="bot-tl-label muted small" title={t.movementHint}>
        {t.movement}
      </span>
      <div className="bot-track line" title={t.movementHint}>
        {f.movement.map((at) => (
          <span key={at} className="bot-dot" style={{ left: pctOf(at, total) }} />
        ))}
      </div>
      <span className="bot-tl-label muted small">{t.boss}</span>
      <div className="bot-track hp">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
          <line x1="0" y1="2" x2="100" y2={2 + 16 * (1 - f.bossEndPct / 100)} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="bot-hp-end small">{Math.round(f.bossEndPct)}%</span>
      </div>
      <span />
      <div className="bot-axis muted small">
        <span>0:00</span>
        <span>{mmss(total / 2)}</span>
        <span>{mmss(total)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- % do potencial

export function PotentialGauge({ p }: { p: Potential }) {
  const t = useMessages(botMsg).potential;
  const lo = Math.min(p.low, p.pct, 1) - 0.05;
  const hi = Math.max(p.high, p.pct, 1) + 0.05;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const inside = p.pct >= p.low && p.pct <= p.high;
  return (
    <div className="bot-gauge panel">
      <span className="muted small">
        {t.label} <Hint>{t.hint}</Hint>
      </span>
      <strong className={`bot-gauge-value ${p.pct >= 0.97 ? 'good' : p.pct >= 0.85 ? 'warn' : 'bad'}`}>{Math.round(p.pct * 100)}%</strong>
      <div className="bot-gauge-track">
        <span className="bot-gauge-band" style={{ left: x(p.low), width: `calc(${x(p.high)} - ${x(p.low)})` }} />
        <span className="bot-gauge-mean" style={{ left: x(1) }} />
        <span className={`bot-gauge-you ${inside ? 'in' : ''}`} style={{ left: x(p.pct) }} />
      </div>
      <span className="muted small">
        {t.band}: {Math.round(p.low * 100)}–{Math.round(p.high * 100)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- cartões de decisão

const pct = (x: number) => Math.round(x * 100);
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

interface CardView {
  spellId: number;
  head: string;
  you: string;
  bot: string;
  times: number[];
}

function cardOf(d: DecisionFinding | BotChoice): CardView {
  const t = messagesOf(botMsg).card;
  switch (d.kind) {
    case 'bot_choice':
      return { spellId: d.buff, head: t.active(d.buffName), you: t.times(d.spell.name, d.times.length), bot: t.share(d.bot.name, pct(d.botShare)), times: d.times };
    case 'proc_lost':
      return { spellId: d.buff, head: t.lost(d.name), you: t.pctLost(pct(d.you)), bot: t.pctLost(pct(d.tops)), times: d.times };
    case 'proc_wait':
      return { spellId: d.buff, head: t.waiting(d.name), you: t.waitCasts(d.you.toFixed(1), d.instead.name), bot: t.waitBot(d.tops.toFixed(1)), times: d.times };
    case 'cd_held':
      return { spellId: d.spellId, head: t.held(d.name), you: t.secs(secs(d.you)), bot: t.secs(secs(d.tops)), times: d.times };
    case 'cd_align':
      return { spellId: d.spellId, head: t.align(d.name, d.partnerName), you: t.together(pct(d.you)), bot: t.together(pct(d.tops)), times: d.times };
  }
}

function Times({ times }: { times: number[] }) {
  const seek = useSeek();
  const list = uniqueSeconds(times);
  if (!list.length) return null;
  return (
    <div className="bot-times">
      {list.slice(0, 6).map((at) => (
        <span key={at} className="rot-time">
          {mmss(at)}
          <PlayAt t={at} seek={seek} />
        </span>
      ))}
      {list.length > 6 && <span className="muted small">+{list.length - 6}</span>}
    </div>
  );
}

function DecisionCard({ d, note, cost }: { d: DecisionFinding | BotChoice; note?: string; cost?: string }) {
  const t = useMessages(botMsg).card;
  const c = cardOf(d);
  return (
    <li className="bot-card">
      <div className="bot-card-head">
        <SpellIcon spellId={c.spellId} size={16} /> <span>{c.head}</span>
      </div>
      {cost && <span className="bot-card-cost small">{cost}</span>}
      <div className="bot-card-vs small">
        <span className="bad">
          {t.you}: {c.you}
        </span>
        <span className="good">
          {t.bot}: {c.bot}
        </span>
      </div>
      <Times times={c.times} />
      {note && <p className="decision-note small">{note}</p>}
    </li>
  );
}

/** Os achados das decisões em cartões: o que foi, você × robô, os momentos e a nota dos tops. */
export function DecisionCards({ items, notes, costs }: { items: (DecisionFinding | BotChoice)[]; notes: Record<string, string>; costs: Map<string, string> }) {
  return (
    <ul className="plain bot-cards">
      {items.map((x) => (
        <DecisionCard key={findingKey(x)} d={x} note={notes[findingKey(x)]} cost={costs.get(findingKey(x))} />
      ))}
    </ul>
  );
}

export const TOP_FIXES = 3;

/** Os três achados que mais custaram, em cima de tudo. */
export function TopFixes({ list, windowMs, notes }: { list: Fix[]; windowMs: number; notes: Record<string, string> }) {
  const t = useMessages(botMsg).fixes;
  if (!list.length) return null;
  return (
    <section className="perf-section">
      <h4>
        {t.title} <Hint>{t.hint}</Hint>
      </h4>
      <ol className="plain bot-cards top">
        {list.slice(0, TOP_FIXES).map((f) => (
          <DecisionCard key={f.key} d={f.item} note={notes[f.key]} cost={fixCost(f, windowMs)} />
        ))}
      </ol>
    </section>
  );
}

export const fixCost = (f: Fix, windowMs: number) => messagesOf(botMsg).fixes.cost(num(f.damage), num(f.damage / Math.max(1, windowMs / 1000)));
