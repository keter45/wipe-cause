import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react';
import type { Pull } from '../types';
import { metricNight, metricOptions, moveMetric, saveBossMetrics, savedBossMetrics, type MetricNight, type MetricOption, type MetricPlayer } from '../lib/bossMetrics';
import { PlayerName } from './Names';
import { Popover } from './Popover';
import { SpellIcon, SpellName } from './SpellIcon';
import { tr, useMessages } from '../i18n';
import { bossMetricsMsg } from './BossMetrics.i18n';
import { Hint } from './ui/Hint';
import { Clamp } from './ui/Clamp';

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
  // as que mais falharam e, com fantasmas, as jardas que eles andaram
  const suggestions = [
    ...options.filter((o) => !o.unit && o.failures > 0 && !keys.includes(o.key)).slice(0, SUGGEST),
    ...options.filter((o) => o.unit && o.amount && !keys.includes(o.key)),
  ];

  return (
    <section className="panel boss-metrics">
      <header className="boss-metrics-head">
        <div>
          <h3>{t.title} <Hint>{t.hint}</Hint></h3>
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
                {o.unit && <span className="muted">· {t.walked}</span>}
                <span className="muted tabular">{o.unit ? t.yards(o.amount ?? 0) : o.failures}</span>
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
                edit={{
                  onRemove: () => toggle(key),
                  onMove: (dir) => setKeys(moveMetric(keys, key, dir)),
                  first: i === 0,
                  last: i === metrics.length - 1,
                }}
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
      <h4>{t.addTitle} <Hint>{t.addHint}</Hint></h4>
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
                <span className="metric-option-name">
                  {o.name}
                  {o.unit && <span className="muted"> · {t.walked}</span>}
                </span>
                <span className={`sev-dot ${o.severity}`} title={t.severities[o.severity]} aria-label={t.severities[o.severity]} />
                {o.unit ? (
                  <span className="small tabular">{t.yards(o.amount ?? 0)}</span>
                ) : (
                  <span className={`small tabular ${o.failures ? '' : 'muted'}`}>{t.failuresShort(o.failures)}</span>
                )}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted small">{t.noMatch}</li>}
      </ul>
    </Popover>
  );
}

/**
 * Cartão de uma métrica. No resumo do boss, com os botões de ordem e de tirar (`edit`) e as barras
 * que abrem o pull; sem eles (imagem do Discord), só leitura, com as listas e a dica inteiras.
 */
export function MetricCard({
  m,
  edit,
  onSelectPull,
}: {
  m: MetricNight;
  edit?: { onRemove: () => void; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean };
  onSelectPull?: (id: number) => void;
}) {
  const full = !edit;
  const t = useMessages(bossMetricsMsg);
  const peak = Math.max(1, ...m.perPull.map((x) => x.failures));
  const stack = m.kind === 'stack_limit';
  const yd = m.unit === 'yd';
  const stats = yd
    ? m.total === 0
      ? t.cleanYards
      : t.statsYards(m.total, m.pullsWithFailure, m.perPull.length)
    : m.total === 0
      ? t.clean
      : stack
        ? t.statsStack(m.players.length, m.pullsWithFailure, m.perPull.length)
        : t.stats(m.total, m.pullsWithFailure, m.perPull.length);
  return (
    <article className={`metric-card ${m.severity}`}>
      <header className="metric-head">
        <strong className="metric-name">
          <SpellName spellId={m.spellId} name={m.name} size={18} />
          {yd && <span className="muted small"> · {t.walked}</span>}
        </strong>
        {edit && (
          <span className="metric-tools">
            <button className="icon-btn" disabled={edit.first} onClick={() => edit.onMove(-1)} title={t.moveUp} aria-label={t.moveUp}>
              <ArrowUp size={14} strokeWidth={1.5} aria-hidden />
            </button>
            <button className="icon-btn" disabled={edit.last} onClick={() => edit.onMove(1)} title={t.moveDown} aria-label={t.moveDown}>
              <ArrowDown size={14} strokeWidth={1.5} aria-hidden />
            </button>
            <button className="icon-btn" onClick={edit.onRemove} title={t.remove(m.name)} aria-label={t.remove(m.name)}>
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        )}
      </header>

      <p className={`small metric-stats ${m.total ? '' : 'good'}`}>
        <span className={`sev-tag ${m.severity}`}>{t.severities[m.severity] ?? m.severity}</span>
        {stats}
      </p>

      <div className="metric-bars" role="img" aria-label={yd ? t.perPullYardsAria(m.name) : t.perPullAria(m.name)}>
        {m.perPull.map(({ pull, failures }) => {
          const label = yd ? t.barYards(pull.pullNumber, failures) : t.barTitle(pull.pullNumber, failures);
          const bar = { className: `metric-bar ${failures ? 'hit' : ''} ${pull.success ? 'kill' : ''}`, style: { height: `${failures ? 18 + (failures / peak) * 82 : 6}%` }, title: label };
          return onSelectPull ? <button key={pull.id} {...bar} aria-label={label} onClick={() => onSelectPull(pull.id)} /> : <span key={pull.id} {...bar} />;
        })}
      </div>

      {/* nas falhas do raid a lista é de quem foi atingido; em failure_event, de quem causou */}
      {m.players.length > 0 && (
        <PeopleList title={yd ? t.whoYards : m.collective && m.kind !== 'failure_event' ? t.hit : t.who} people={m.players} stack={stack} yards={yd} tone="bad" full={full} />
      )}
      {m.helpers.length > 0 && <PeopleList title={t.helpers} people={m.helpers} tone="good" full={full} />}
      {tr(m.tip) && <p className="muted small metric-tip">{full ? tr(m.tip) : <Clamp>{tr(m.tip)}</Clamp>}</p>}
    </article>
  );
}

function PeopleList({ title, people, stack = false, yards = false, tone, full = false }: { title: string; people: MetricPlayer[]; stack?: boolean; yards?: boolean; tone: 'bad' | 'good'; full?: boolean }) {
  const t = useMessages(bossMetricsMsg);
  const [all, setAll] = useState(full);
  const shown = all ? people : people.slice(0, TOP);
  return (
    <div className={`metric-people ${yards ? 'metric-people-yards' : ''}`}>
      <span className="tile-label">{title}</span>
      <ul className="plain">
        {shown.map((p) => (
          <li key={p.guid}>
            <PlayerName name={p.name} guid={p.guid} cls={p.class} />
            <strong className={`tabular ${tone}`}>{yards ? t.yards(p.count) : stack ? t.inPulls(p.count) : t.times(p.count)}</strong>
            <span className="muted small">{yards ? t.ghosts(p.max, p.count) : stack ? t.maxStacks(p.max) : t.inPulls(p.pulls)}</span>
          </li>
        ))}
      </ul>
      {people.length > TOP && !full && (
        <button className="btn ghost sm" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '−' : t.more(people.length - TOP)}
        </button>
      )}
    </div>
  );
}
