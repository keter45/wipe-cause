// Página inicial do link de visualização: o try da vez (resultado, gatilho, mortes, erros) e o
// resumo do boss na noite, passando de try em try. Pouco texto: ícones de boss e de habilidade,
// barras e marcas.
//
// Quem manda no try mostrado é este componente (`viewedId`). "Acompanhando" = mostra sempre o último
// try e anda sozinho quando chega um novo; ir para um try anterior para de acompanhar e aparece o
// botão do try novo; voltar ao último volta a acompanhar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Play, Radio } from 'lucide-react';
import type { Pull } from '../../types';
import type { LiveStatus } from '../../lib/api';
import { analyzePull, lowestBossHp } from '../../lib/verdict';
import { bossKey, summarizeNight } from '../../lib/night';
import { phaseCountOf, progressLabel, pullProgress, reachedPhase } from '../../lib/phases';
import { mechanicSpellId } from '../../lib/spells';
import { wipeCallText } from '../../lib/wipeCall';
import { raidOnly } from '../../lib/content';
import { classColor, longDuration, mmss, shortName } from '../../lib/format';
import { BossIcon, BossName, PlayerName } from '../Names';
import { SpellIcon, SpellName } from '../SpellIcon';
import { useMessages } from '../../i18n';
import { viewerHomeMsg } from './ViewerHome.i18n';
import { GroupMetrics, Highlights, NoteCds } from './ViewerPanels';

interface Props {
  pulls: Pull[];
  live: LiveStatus;
  /** abre a análise completa do try (a mesma tela do app) */
  onOpenPull: (id: number) => void;
  /** abre o try direto na aba Replay */
  onReplay?: (id: number) => void;
}

export function ViewerHome({ pulls: all, live, onOpenPull, onReplay }: Props) {
  const t = useMessages(viewerHomeMsg);
  const pulls = useMemo(() => {
    const raid = raidOnly(all);
    return (raid.length ? raid : all).slice().sort((a, b) => a.startMs - b.startMs);
  }, [all]);
  const last = pulls[pulls.length - 1];
  const [viewedId, setViewedId] = useState<number | null>(last?.id ?? null);
  const [following, setFollowing] = useState(true);

  // chegou try novo: quem acompanha vai para ele; o try visto sumiu (outra noite): volta ao último
  useEffect(() => {
    if (!last) return;
    if (following || !pulls.some((p) => p.id === viewedId)) {
      setViewedId(last.id);
      setFollowing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, pulls.length]);

  const viewed = pulls.find((p) => p.id === viewedId) ?? last;
  // o boss do try visto: a faixa de tries e o resumo são dele
  const bossPulls = useMemo(() => (viewed ? pulls.filter((p) => bossKey(p) === bossKey(viewed)) : []), [pulls, viewed]);
  const bosses = useMemo(() => {
    const m = new Map<string, Pull[]>();
    for (const p of pulls) m.set(bossKey(p), [...(m.get(bossKey(p)) ?? []), p]);
    return [...m.values()];
  }, [pulls]);

  function view(id: number) {
    setViewedId(id);
    setFollowing(id === last?.id);
  }
  const index = viewed ? bossPulls.findIndex((p) => p.id === viewed.id) : -1;
  const step = (d: -1 | 1) => {
    const p = bossPulls[index + d];
    if (p) view(p.id);
  };

  // ← → passam de try (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!viewed) return <p className="muted viewer-home-empty">{t.loading}</p>;
  const newer = !following && last && last.id !== viewed.id ? last : null;

  return (
    <div className="viewer-home">
      <header className="vh-head">
        {bosses.length > 1 ? (
          <div className="vh-bosses" role="group" aria-label={t.tries}>
            {bosses.map((bp) => {
              const p = bp[bp.length - 1];
              const on = bossKey(p) === bossKey(viewed);
              return (
                <button key={bossKey(p)} className={`vh-boss ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => view(p.id)} title={bossKey(p)}>
                  <BossIcon encounterId={p.encounterId} size={28} />
                  <span className="vh-boss-count tabular">{bp.length}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <h1 className="vh-title">
          <BossName encounterId={viewed.encounterId} name={viewed.encounterName} size={36} />
          <span className="muted vh-diff">{viewed.difficultyName}</span>
        </h1>
        <span className="topbar-spacer" />
        {following && live.active && (
          <span className="vh-following small" role="status">
            <Radio size={14} strokeWidth={1.75} aria-hidden /> {t.following}
          </span>
        )}
        {newer && (
          <button className="btn sm" onClick={() => view(newer.id)}>
            {t.newTry(newer.pullNumber)}
          </button>
        )}
        <nav className="vh-nav" aria-label={t.tries}>
          <button className="icon-btn" onClick={() => step(-1)} disabled={index <= 0} aria-label={t.prev} title={t.prev}>
            <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <span className="tabular vh-nav-label">{t.tryOf(viewed.pullNumber, bossPulls[bossPulls.length - 1]?.pullNumber ?? viewed.pullNumber)}</span>
          <button className="icon-btn" onClick={() => step(1)} disabled={index >= bossPulls.length - 1} aria-label={t.next} title={t.next}>
            <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </nav>
      </header>

      <TryStrip pulls={bossPulls} viewedId={viewed.id} onView={view} />

      <div className="vh-grid">
        <TryReport pull={viewed} bossPulls={bossPulls} onOpen={() => onOpenPull(viewed.id)} onReplay={onReplay ? () => onReplay(viewed.id) : undefined} />
        <BossNight pulls={bossPulls} onView={view} />
      </div>
      <GroupMetrics pulls={bossPulls} viewedId={viewed.id} onView={view} />
      <Highlights pulls={bossPulls} />
    </div>
  );
}

/** Altura (em %) de cada faixa da linha do tempo das mortes. */
const LANE_TOP = [50, 22, 78];

/** Uma barra por try do boss: altura = quanto avançou na luta. Clicar abre o try. */
function TryStrip({ pulls, viewedId, onView }: { pulls: Pull[]; viewedId: number; onView: (id: number) => void }) {
  const t = useMessages(viewerHomeMsg);
  const phases = phaseCountOf(pulls);
  // o try visto fica à vista (no celular a faixa rola)
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.vh-bar.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [viewedId, pulls.length]);
  // altura relativa ao melhor try da noite: sem passar da P1, a luta toda deixaria as barras rentes
  const best = Math.max(0.0001, ...pulls.map((p) => pullProgress(p, phases)));
  return (
    <div className="vh-strip" role="group" aria-label={t.stripAria} ref={ref}>
      {pulls.map((p) => {
        const progress = Math.max(0.04, pullProgress(p, phases) / best);
        const result = p.success ? t.kill : progressLabel(p);
        const on = p.id === viewedId;
        return (
          <button key={p.id} className={`vh-bar ${on ? 'on' : ''} ${p.success ? 'kill' : ''}`} aria-current={on ? 'true' : undefined} aria-label={t.tryAria(p.pullNumber, result)} title={t.tryAria(p.pullNumber, result)} onClick={() => onView(p.id)}>
            <span className="vh-bar-fill" style={{ height: `${progress * 100}%` }} />
            <span className="vh-bar-n tabular">{p.pullNumber}</span>
          </button>
        );
      })}
    </div>
  );
}

/** O try da vez: resultado e barra de progresso, gatilho, mortes no tempo e os erros. */
function TryReport({ pull, bossPulls, onOpen, onReplay }: { pull: Pull; bossPulls: Pull[]; onOpen: () => void; onReplay?: () => void }) {
  const t = useMessages(viewerHomeMsg);
  const verdict = useMemo(() => analyzePull(pull), [pull]);
  const phases = phaseCountOf([pull]);
  const phase = reachedPhase(pull);
  const hp = lowestBossHp(pull);
  const call = wipeCallText(pull);
  const callTrigger = call ? pull.wipeCall?.trigger : undefined;
  const trigger = callTrigger?.spellId != null
    ? { spellId: callTrigger.spellId, name: callTrigger.spell ?? callTrigger.name ?? '', t: callTrigger.t }
    : pull.trigger
      ? { spellId: mechanicSpellId(pull, pull.trigger.key), name: pull.trigger.name, t: pull.trigger.t }
      : null;
  const first = verdict.decisiveDeaths[0] ?? null;
  const deaths = pull.deaths.filter((d) => !d.ignored);
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));
  const span = Math.max(1, pull.durationMs);
  // mortes coladas no tempo não se cobrem: cada uma vai para a primeira faixa livre (até 3)
  const lanes = useMemo(() => {
    const lastAt = [-Infinity, -Infinity, -Infinity];
    return deaths.map((d) => {
      const x = (d.t / span) * 100;
      let lane = lastAt.findIndex((l) => x - l >= 2.2);
      if (lane < 0) lane = lastAt.indexOf(Math.min(...lastAt));
      lastAt[lane] = x;
      return lane;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull]);

  // erros que pesaram, um por habilidade: quantos jogadores e quantas vezes
  const mistakes = useMemo(() => {
    const seen = new Set<number>();
    const out: { spellId: number; name: string; people: number; times: number }[] = [];
    for (const f of verdict.findings) {
      if (f.spellId == null || seen.has(f.spellId) || (f.severity !== 'wipe' && f.severity !== 'major')) continue;
      seen.add(f.spellId);
      const m = pull.mechanics.find((x) => x.spellId === f.spellId && x.failures > 0);
      const blamed = m ? m.players.filter((x) => !x.credit) : [];
      const byDeath = verdict.decisiveDeaths.filter((d) => d.killingBlow?.spellId === f.spellId);
      const people = blamed.length || new Set(byDeath.map((d) => d.guid)).size;
      const times = m ? m.failures : byDeath.length;
      out.push({ spellId: f.spellId, name: m?.name ?? byDeath[0]?.killingBlow?.spellName ?? '', people, times });
    }
    return out.slice(0, 5);
  }, [pull, verdict]);
  const maxTimes = Math.max(1, ...mistakes.map((m) => m.times));

  return (
    <section className="panel vh-try" aria-label={t.tryOf(pull.pullNumber, pull.pullNumber)}>
      <div className="vh-result">
        <span className={`vh-pct ${pull.success ? 'kill' : ''}`}>{pull.success ? t.kill : phase ? `${phase.short} ${hp != null ? `${hp.toFixed(1)}%` : ''}` : `${(hp ?? 100).toFixed(1)}%`}</span>
        <span className="muted tabular vh-dur">{mmss(pull.durationMs)}</span>
      </div>
      <div className="vh-progress" aria-hidden>
        <span className={`vh-progress-fill ${pull.success ? 'kill' : ''}`} style={{ width: `${pullProgress(pull, phases) * 100}%` }} />
        {phases > 1 && Array.from({ length: phases - 1 }, (_, i) => <span key={i} className="vh-progress-tick" style={{ left: `${((i + 1) / phases) * 100}%` }} />)}
      </div>

      {!pull.success && (trigger || first) && (
        <div className="vh-why">
          {trigger && (
            <div className="vh-why-item">
              <span className="muted small">{t.trigger}</span>
              <span className="vh-why-main">
                <SpellName spellId={trigger.spellId} name={trigger.name} size={28} />
                <span className="muted small tabular">{t.at(mmss(trigger.t))}</span>
              </span>
            </div>
          )}
          {first && (
            <div className="vh-why-item">
              <span className="muted small">{t.firstDeath}</span>
              <span className="vh-why-main">
                <PlayerName name={first.name} guid={first.guid} cls={first.class} />
                {first.killingBlow && <SpellIcon spellId={first.killingBlow.spellId} size={20} title={first.killingBlow.spellName} />}
                <span className="muted small tabular">{mmss(first.t)}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {deaths.length > 0 && (
        <div className="vh-deaths">
          <span className="muted small">{t.deaths(deaths.length)}</span>
          <div className="vh-timeline" role="list" aria-label={t.deathsAria}>
            {pull.cutoffT != null && <span className="vh-cut" style={{ left: `${(pull.cutoffT / span) * 100}%` }} title={t.wipeCall} />}
            {deaths.map((d, i) => {
              const big = decisive.has(`${d.guid}:${d.t}`);
              const lane = lanes[i];
              const label = `${shortName(d.name)} · ${d.killingBlow?.spellName ?? ''} · ${mmss(d.t)}`;
              return (
                <span key={`${d.guid}:${d.t}`} role="listitem" tabIndex={0} className={`vh-death ${big ? 'big' : ''}`} style={{ left: `${(d.t / span) * 100}%`, top: `${LANE_TOP[lane]}%`, background: classColor(d.class) }} title={label} aria-label={label} />
              );
            })}
          </div>
          <div className="vh-axis muted small tabular" aria-hidden>
            <span>0:00</span>
            <span>{mmss(pull.durationMs)}</span>
          </div>
        </div>
      )}

      {!pull.success && (
        <div className="vh-mistakes">
          <span className="muted small">{t.mistakes}</span>
          {mistakes.length === 0 ? (
            <span className="muted small">{t.noMistakes}</span>
          ) : (
            <ul>
              {mistakes.map((m) => (
                <li key={m.spellId} className="vh-row">
                  <SpellName spellId={m.spellId} name={m.name} size={22} />
                  <span className="vh-row-bar" aria-hidden>
                    <span style={{ width: `${(m.times / maxTimes) * 100}%` }} />
                  </span>
                  <span className="tabular vh-row-n" title={t.people(m.people)}>
                    {m.times}× <span className="muted small vh-people">· {t.people(m.people)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <NoteCds pulls={bossPulls} pull={pull} />

      <div className="vh-actions">
        {onReplay && (
          <button className="btn ghost sm" onClick={onReplay}>
            <Play size={14} strokeWidth={2} aria-hidden /> {t.replay}
          </button>
        )}
        <button className="btn sm" onClick={onOpen}>
          {t.open} <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </section>
  );
}

/** O boss na noite: melhor try, kills e wipes, tempo em combate, o que mais derrubou e quem mais morreu cedo. */
function BossNight({ pulls, onView }: { pulls: Pull[]; onView: (id: number) => void }) {
  const t = useMessages(viewerHomeMsg);
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const causes = s.causes.filter((c) => c.triggers > 0).slice(0, 5);
  const maxCause = Math.max(1, ...causes.map((c) => c.triggers));
  const firsts = s.players
    .filter((p) => p.decisiveDeaths > 0)
    .sort((a, b) => b.decisiveDeaths - a.decisiveDeaths)
    .slice(0, 5);
  const maxFirst = Math.max(1, ...firsts.map((p) => p.decisiveDeaths));

  return (
    <aside className="panel vh-night" aria-label={t.night}>
      <div className="vh-stats">
        {s.best && (
          <button className="vh-stat vh-best" onClick={() => onView(s.best!.pull.id)} title={t.tryAria(s.best.pull.pullNumber, s.best.label)}>
            <span className="muted small">{t.best}</span>
            <strong className="tabular">{s.best.label}</strong>
            <span className="muted small tabular">#{s.best.pull.pullNumber}</span>
          </button>
        )}
        <div className="vh-stat">
          <span className="muted small">{t.tries}</span>
          <strong className="tabular">{s.pulls.length}</strong>
          <span className="muted small">{s.kills > 0 ? t.kills(s.kills) : t.wipes(s.wipes)}</span>
        </div>
        <div className="vh-stat">
          <span className="muted small">{t.combat}</span>
          <strong className="tabular">{longDuration(s.combatMs)}</strong>
        </div>
      </div>

      {causes.length > 0 && (
        <div className="vh-block">
          <h3 className="vh-h">{t.causes}</h3>
          <ul>
            {causes.map((c) => (
              <li key={c.key} className="vh-row">
                <SpellName spellId={mechanicSpellId(pulls, c.key)} name={c.name} size={22} />
                <span className="vh-row-bar wipe" aria-hidden>
                  <span style={{ width: `${(c.triggers / maxCause) * 100}%` }} />
                </span>
                <span className="tabular vh-row-n">{t.causeCount(c.triggers)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {firsts.length > 0 && (
        <div className="vh-block">
          <h3 className="vh-h">{t.firstToDie}</h3>
          <ul>
            {firsts.map((p) => (
              <li key={p.guid} className="vh-row">
                <PlayerName name={p.name} guid={p.guid} cls={p.class} />
                <span className="vh-row-bar" aria-hidden>
                  <span style={{ width: `${(p.decisiveDeaths / maxFirst) * 100}%`, background: classColor(p.class) }} />
                </span>
                <span className="tabular vh-row-n">{p.decisiveDeaths}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
