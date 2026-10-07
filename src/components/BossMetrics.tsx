import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react';
import type { Pull } from '../types';
import { metricNight, metricOptions, moveMetric, saveBossMetrics, savedBossMetrics, type MetricNight, type MetricOption, type MetricPlayer } from '../lib/bossMetrics';
import { PlayerName } from './Names';
import { Popover } from './Popover';
import { SpellIcon, SpellName } from './SpellIcon';
import { tr, useMessages } from '../i18n';
import { bossMetricsMsg } from './BossMetrics.i18n';

/** Quantas pessoas cada lista mostra antes do "+ N". */
const TOP = 5;
/** Sugestões quando ainda não há métrica escolhida. */
const SUGGEST = 3;

/** Resumo do boss: as mecânicas que o grupo escolheu acompanhar, cada uma somada na noite. */
export function BossMetrics({ pulls, onSelectPull }: { pulls: Pull[]; onSelectPull: (id: number) => void }) {
  const t = useMessages(bossMetricsMsg);
  const encounterId = pulls[0]?.encounterId ?? 0;
  const [keys, setKeysState] = useState<string[]>(() => savedBossMetrics(encounterId));
  const [loadedFor, setLoadedFor] = useState(encounterId);
  // outro boss na mesma tela: carrega a escolha dele
  if (loadedFor !== encounterId) {
    setLoadedFor(encounterId);
    setKeysState(savedBossMetrics(encounterId));
  }
  const setKeys = (k: string[]) => {
    setKeysState(k);
    saveBossMetrics(encounterId, k);
  };
  const options = useMemo(() => metricOptions(pulls), [pulls]);
  const metrics = useMemo(() => keys.map((k) => ({ key: k, m: metricNight(pulls, k) })), [pulls, keys]);
  const toggle = (k: string) => setKeys(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]);

  if (!options.length) return null;
  const suggestions = options.filter((o) => o.failures > 0 && !keys.includes(o.key)).slice(0, SUGGEST);

  return (
    <section className="panel boss-metrics">
      <header className="boss-metrics-head">
        <div>
          <h3>{t.title}</h3>
          <p className="muted small">{t.hint}</p>
        </div>
        <AddMetric options={options} chosen={keys} onToggle={toggle} />
      </header>
      {keys.length === 0 && suggestions.length > 0 && (
        <div className="metric-suggest">
          <span className="muted small">{t.empty}</span>
          <div className="chips">
            {suggestions.map((o) => (
              <button key={o.key} onClick={() => toggle(o.key)}>
                <Plus size={12} strokeWidth={2} aria-hidden /> <SpellName spellId={o.spellId} name={o.name} size={14} />
                <span className="muted tabular">{o.failures}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {metrics.length > 0 && (
        <div className="metric-grid">
          {metrics.map(({ key, m }, i) =>
            m ? (
              <MetricCard
                key={key}
                m={m}
                onRemove={() => toggle(key)}
                onMove={(dir) => setKeys(moveMetric(keys, key, dir))}
                first={i === 0}
                last={i === metrics.length - 1}
                onSelectPull={onSelectPull}
              />
            ) : (
              <article key={key} className="metric-card gone">
                <span className="muted small">{t.gone(key)}</span>
                <button className="icon-btn" onClick={() => toggle(key)} title={t.remove(key)} aria-label={t.remove(key)}>
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function AddMetric({ options, chosen, onToggle }: { options: MetricOption[]; chosen: string[]; onToggle: (key: string) => void }) {
  const t = useMessages(bossMetricsMsg);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t.addTitle}
      trigger={
        <button className={`btn sm ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Plus size={14} strokeWidth={2} aria-hidden /> {t.add}
        </button>
      }
    >
      <h4>{t.addTitle}</h4>
      <p className="muted small">{t.addHint}</p>
      {options.length > 8 && <input className="text-input sm" autoFocus placeholder={t.search} aria-label={t.search} value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul className="plain metric-options">
        {shown.map((o) => {
          const on = chosen.includes(o.key);
          return (
            <li key={o.key}>
              <button className={`metric-option ${on ? 'on' : ''}`} role="checkbox" aria-checked={on} onClick={() => onToggle(o.key)}>
                <span className="metric-check" aria-hidden>
                  {on && <Check size={12} strokeWidth={2.5} />}
                </span>
                <SpellIcon spellId={o.spellId} size={16} />
                <span className="metric-option-name">{o.name}</span>
                <span className={`sev-dot ${o.severity}`} title={t.severities[o.severity]} aria-label={t.severities[o.severity]} />
                <span className={`small tabular ${o.failures ? '' : 'muted'}`}>{t.failuresShort(o.failures)}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted small">{t.noMatch}</li>}
      </ul>
    </Popover>
  );
}

function MetricCard({
  m,
  onRemove,
  onMove,
  first,
  last,
  onSelectPull,
}: {
  m: MetricNight;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
  onSelectPull: (id: number) => void;
}) {
  const t = useMessages(bossMetricsMsg);
  const peak = Math.max(1, ...m.perPull.map((x) => x.failures));
  const stack = m.kind === 'stack_limit';
  return (
    <article className={`metric-card ${m.severity}`}>
      <header className="metric-head">
        <strong className="metric-name">
          <SpellName spellId={m.spellId} name={m.name} size={18} />
        </strong>
        <span className="metric-tools">
          <button className="icon-btn" disabled={first} onClick={() => onMove(-1)} title={t.moveUp} aria-label={t.moveUp}>
            <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button className="icon-btn" disabled={last} onClick={() => onMove(1)} title={t.moveDown} aria-label={t.moveDown}>
            <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
          </button>
          <button className="icon-btn" onClick={onRemove} title={t.remove(m.name)} aria-label={t.remove(m.name)}>
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
      </header>

      <p className={`small metric-stats ${m.total ? '' : 'good'}`}>
        <span className={`sev-tag ${m.severity}`}>{t.severities[m.severity] ?? m.severity}</span>
        {m.total === 0 ? t.clean : stack ? t.statsStack(m.players.length, m.pullsWithFailure, m.perPull.length) : t.stats(m.total, m.pullsWithFailure, m.perPull.length)}
      </p>

      <div className="metric-bars" role="img" aria-label={t.perPullAria(m.name)}>
        {m.perPull.map(({ pull, failures }) => (
          <button
            key={pull.id}
            className={`metric-bar ${failures ? 'hit' : ''} ${pull.success ? 'kill' : ''}`}
            style={{ height: `${failures ? 18 + (failures / peak) * 82 : 6}%` }}
            title={t.barTitle(pull.pullNumber, failures)}
            aria-label={t.barTitle(pull.pullNumber, failures)}
            onClick={() => onSelectPull(pull.id)}
          />
        ))}
      </div>

      {/* nas falhas do raid a lista é de quem foi atingido; em failure_event, de quem causou */}
      {m.players.length > 0 && <PeopleList title={m.collective && m.kind !== 'failure_event' ? t.hit : t.who} people={m.players} stack={stack} tone="bad" />}
      {m.helpers.length > 0 && <PeopleList title={t.helpers} people={m.helpers} tone="good" />}
      {tr(m.tip) && <p className="muted small metric-tip">{tr(m.tip)}</p>}
    </article>
  );
}

function PeopleList({ title, people, stack = false, tone }: { title: string; people: MetricPlayer[]; stack?: boolean; tone: 'bad' | 'good' }) {
  const t = useMessages(bossMetricsMsg);
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, TOP);
  return (
    <div className="metric-people">
      <span className="tile-label">{title}</span>
      <ul className="plain">
        {shown.map((p) => (
          <li key={p.guid}>
            <PlayerName name={p.name} guid={p.guid} cls={p.class} />
            <strong className={`tabular ${tone}`}>{stack ? t.inPulls(p.count) : t.times(p.count)}</strong>
            <span className="muted small">{stack ? t.maxStacks(p.max) : t.inPulls(p.pulls)}</span>
          </li>
        ))}
      </ul>
      {people.length > TOP && (
        <button className="btn ghost sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '−' : t.more(people.length - TOP)}
        </button>
      )}
    </div>
  );
}
