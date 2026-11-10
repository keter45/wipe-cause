// Blocos do início do link de visualização, no mesmo desenho da página (ícone + nome · barra ·
// número): as métricas do grupo que quem compartilha escolheu, os destaques da noite e os CDs da
// note de cura do try (quem não usou ou usou fora de hora).

import { useMemo } from 'react';
import { ShieldOff } from 'lucide-react';
import type { Pull } from '../../types';
import { metricNight, savedBossMetrics, type MetricNight } from '../../lib/bossMetrics';
import { summarizeNight, topBy } from '../../lib/night';
import { noteFor, noteVersions, parseNote, type ParsedNote } from '../../lib/healNote';
import { matchLines, phaseOffsets, type LineCheck } from '../../lib/healNoteCheck';
import { classColor, mmss, shortName } from '../../lib/format';
import { PlayerName } from '../Names';
import { SpellIcon, SpellName } from '../SpellIcon';
import { heroAwards, villainAwards, type Award } from '../NightSummary';
import { useMessages } from '../../i18n';
import { viewerHomeMsg } from './ViewerHome.i18n';

// ---------------------------------------------------------------- métricas do grupo

/** As métricas escolhidas no resumo do boss: uma barra por try (o visto em destaque) e quem mais errou. */
export function GroupMetrics({ pulls, viewedId, onView }: { pulls: Pull[]; viewedId: number; onView: (id: number) => void }) {
  const t = useMessages(viewerHomeMsg);
  const encounterId = pulls[0]?.encounterId;
  const metrics = useMemo(
    () => (encounterId != null ? savedBossMetrics(encounterId).map((k) => metricNight(pulls, k)).filter((m): m is MetricNight => m != null) : []),
    [pulls, encounterId],
  );
  if (!metrics.length) return null;
  return (
    <section className="panel vh-panel" aria-label={t.metrics}>
      <h3 className="vh-h">{t.metrics}</h3>
      <div className="vh-metrics">
        {metrics.map((m) => (
          <MetricMini key={m.key} m={m} viewedId={viewedId} onView={onView} />
        ))}
      </div>
    </section>
  );
}

function MetricMini({ m, viewedId, onView }: { m: MetricNight; viewedId: number; onView: (id: number) => void }) {
  const t = useMessages(viewerHomeMsg);
  const yd = m.unit === 'yd';
  const fmt = (n: number) => (yd ? t.yards(Math.round(n)) : `${n}×`);
  const max = Math.max(1, ...m.perPull.map((x) => x.failures));
  const people = (m.collective ? m.helpers : m.players).slice(0, 3);
  const viewed = m.perPull.find((x) => x.pull.id === viewedId);
  return (
    <article className="vh-metric">
      <header className="vh-metric-head">
        {m.spellId != null ? (
          <SpellName spellId={m.spellId} name={m.name} size={22} />
        ) : (
          // métrica sem habilidade (mortes sem pot/defensivo): ícone de escudo no lugar
          <span className="vh-metric-name">
            <ShieldOff size={20} strokeWidth={1.5} aria-hidden /> {m.name}
          </span>
        )}
        <span className="tabular vh-metric-total" title={t.metricTotal}>
          {viewed && <span className={viewed.failures ? 'bad' : 'ok-text'}>{fmt(viewed.failures)}</span>}
          <span className="muted small"> / {fmt(m.total)}</span>
        </span>
      </header>
      <div className="vh-spark" role="group" aria-label={m.name}>
        {m.perPull.map(({ pull, failures }) => (
          <button
            key={pull.id}
            className={`vh-spark-bar ${pull.id === viewedId ? 'on' : ''} ${failures ? '' : 'zero'}`}
            onClick={() => onView(pull.id)}
            title={`#${pull.pullNumber}: ${fmt(failures)}`}
            aria-label={`#${pull.pullNumber}: ${fmt(failures)}`}
          >
            <span style={{ height: `${Math.max(failures ? 12 : 4, (failures / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      {people.length > 0 && (
        <div className="vh-metric-people">
          {people.map((p) => (
            <span key={p.guid} className="who-chip" style={{ color: classColor(p.class) }}>
              {shortName(p.name)} <span className="muted">{yd ? t.yards(Math.round(p.count)) : `${p.count}×`}</span>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- destaques

/** Os destaques da noite (os mesmos do resumo): o melhor em cada categoria, e quem vem depois. */
export function Highlights({ pulls }: { pulls: Pull[] }) {
  const t = useMessages(viewerHomeMsg);
  const s = useMemo(() => summarizeNight(pulls), [pulls]);
  const groups: { title: string; tone: 'good' | 'bad'; awards: Award[] }[] = [
    { title: t.heroes, tone: 'good', awards: heroAwards() },
    { title: t.villains, tone: 'bad', awards: villainAwards() },
  ];
  return (
    <section className="panel vh-panel" aria-label={t.highlights}>
      <h3 className="vh-h">{t.highlights}</h3>
      <div className="vh-highlights">
        {groups.map((g) => (
          <div key={g.title} className={`vh-award-group ${g.tone}`}>
            <span className="small vh-award-title">{g.title}</span>
            <ul>
              {g.awards.map((a) => {
                const top = topBy(s.players, a.score, 3);
                const [first, ...rest] = top;
                return (
                  <li key={a.label} className="vh-award">
                    <a.icon size={18} strokeWidth={1.5} className="vh-award-icon" aria-hidden />
                    <span className="vh-award-label small muted">{a.label}</span>
                    {first ? (
                      <span className="vh-award-who">
                        <PlayerName name={first.name} guid={first.guid} cls={first.class} />
                        <span className="muted small tabular">{a.format(first)}</span>
                        {rest.map((p) => (
                          <span key={p.guid} className="small vh-award-next" style={{ color: classColor(p.class) }} title={a.format(p)}>
                            {shortName(p.name)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- CDs da note de cura

type Issue = { check: LineCheck; spellId: number | null; name: string; cls: string | null; guid: string | undefined };

/**
 * CDs da note no try visto: quantos saíram na hora (barra) e, um por linha, quem não usou, usou
 * antes ou depois da hora, ou estava morto. Mesma conferência da aba CDs de cura.
 */
export function NoteCds({ pulls, pull }: { pulls: Pull[]; pull: Pull }) {
  const t = useMessages(viewerHomeMsg);
  const boss = pulls[0];
  const { note, checks } = useMemo(() => {
    if (!boss) return { note: null, checks: [] as LineCheck[] };
    const versions = noteVersions(boss);
    if (!versions.length) return { note: null, checks: [] as LineCheck[] };
    const parsed = new Map(versions.map((v) => [v.savedAt, parseNote(v.text)]));
    const noteOf = (p: Pull): ParsedNote | null => {
      const v = noteFor(p, pulls, versions);
      return v ? (parsed.get(v.savedAt) ?? null) : null;
    };
    const offsets = phaseOffsets(pulls, noteOf);
    const all = matchLines(pulls, noteOf, offsets);
    return { note: noteOf(pull), checks: all.get(pull.id) ?? [] };
  }, [boss, pulls, pull]);

  const judged = checks.filter((c) => ['on_time', 'early', 'late', 'dead', 'not_used'].includes(c.state));
  if (!note || !judged.length) return null;
  const onTime = judged.filter((c) => c.state === 'on_time').length;
  const issues: Issue[] = judged
    .filter((c) => c.state !== 'on_time')
    .sort((a, b) => (a.expectedMs ?? 0) - (b.expectedMs ?? 0))
    .map((c) => {
      const line = note.lines[c.lineIndex];
      const player = pull.players.find((p) => p.guid === c.guid);
      return { check: c, spellId: line?.spellId ?? null, name: player?.name ?? line?.tag ?? '?', cls: player?.class ?? null, guid: c.guid };
    });

  const stateLabel = (c: LineCheck) =>
    c.state === 'not_used' ? t.cdNotUsed : c.state === 'dead' ? t.cdDead : c.deltaMs != null ? (c.deltaMs > 0 ? `+${Math.round(c.deltaMs / 1000)}s` : `${Math.round(c.deltaMs / 1000)}s`) : c.state;

  return (
    <div className="vh-notecds">
      <div className="vh-notecds-head">
        <span className="muted small">{t.noteCds}</span>
        <span className="vh-row-bar ok" aria-hidden>
          <span style={{ width: `${(onTime / judged.length) * 100}%` }} />
        </span>
        <span className="tabular small">{t.onTime(onTime, judged.length)}</span>
      </div>
      {issues.length > 0 && (
        <ul>
          {issues.map(({ check: c, spellId, name, cls, guid }) => (
            <li key={c.lineIndex} className="vh-cd">
              <span className="muted small tabular">{c.expectedMs != null ? mmss(c.expectedMs) : ''}</span>
              {spellId != null ? <SpellIcon spellId={spellId} size={20} /> : <span />}
              <PlayerName name={name} guid={guid} cls={cls} />
              <span className={`vh-cd-state ${c.state}`} title={c.usedMs != null ? t.usedAt(mmss(c.usedMs)) : undefined}>
                {stateLabel(c)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
