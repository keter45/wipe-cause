// Blocos do try no início do link de visualização, no mesmo desenho da página (ícone + nome ·
// barra · número): as métricas do grupo que quem compartilha escolheu e os CDs da note de cura (quem
// não usou ou usou fora de hora).

import { useMemo } from 'react';
import { Play, ShieldOff } from 'lucide-react';
import type { Pull } from '../../types';
import { metricNight, savedBossMetrics } from '../../lib/bossMetrics';
import { noteFor, noteVersions, parseNote, type ParsedNote } from '../../lib/healNote';
import { matchLines, phaseOffsets, type LineCheck } from '../../lib/healNoteCheck';
import { classColor, mmss, shortName } from '../../lib/format';
import { PlayerName } from '../Names';
import { SpellIcon, SpellName } from '../SpellIcon';
import { useMessages } from '../../i18n';
import { viewerHomeMsg } from './ViewerHome.i18n';

/** ▶ que leva o replay do card de baixo até o momento. */
export function PlayAt({ onPlay }: { onPlay: () => void }) {
  const t = useMessages(viewerHomeMsg);
  return (
    <button className="icon-btn sm vh-play" onClick={onPlay} title={t.playHere} aria-label={t.playHere}>
      <Play size={13} strokeWidth={2} aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------- métricas do grupo

interface TryMetric {
  key: string;
  name: string;
  spellId: number | null;
  yd: boolean;
  /** neste try (null = a mecânica não foi avaliada nele) */
  count: number | null;
  /** o pior try da noite, para a barra dizer se este foi bom ou ruim */
  worst: number;
  people: { guid: string; name: string; class: string | null; count: number }[];
}

/**
 * As métricas escolhidas no resumo do boss, só do try visto: quantas vezes neste try (barra na
 * escala do pior try da noite) e quem errou nele.
 */
export function TryMetrics({ pulls, pull }: { pulls: Pull[]; pull: Pull }) {
  const t = useMessages(viewerHomeMsg);
  const encounterId = pull.encounterId;
  const rows = useMemo((): TryMetric[] => {
    if (encounterId == null) return [];
    return savedBossMetrics(encounterId).flatMap((key) => {
      const night = metricNight(pulls, key);
      if (!night) return [];
      const here = metricNight([pull], key);
      const who = here ? (here.collective ? here.helpers : here.players) : [];
      return [
        {
          key,
          name: night.name,
          spellId: night.spellId,
          yd: night.unit === 'yd',
          count: here ? here.total : null,
          worst: Math.max(1, ...night.perPull.map((x) => x.failures)),
          people: who.slice(0, 4).map((p) => ({ guid: p.guid, name: p.name, class: p.class, count: p.count })),
        },
      ];
    });
  }, [pulls, pull, encounterId]);
  if (!rows.length) return null;
  const fmt = (m: TryMetric, n: number) => (m.yd ? t.yards(Math.round(n)) : `${n}×`);
  return (
    <div className="vh-mistakes">
      <span className="muted small">{t.metrics}</span>
      <ul>
        {rows.map((m) => (
          <li key={m.key} className="vh-metric-row">
            <div className="vh-row">
              {m.spellId != null ? (
                <SpellName spellId={m.spellId} name={m.name} size={22} />
              ) : (
                // métrica sem habilidade (mortes sem pot/defensivo): ícone de escudo no lugar
                <span className="vh-metric-name">
                  <ShieldOff size={20} strokeWidth={1.5} aria-hidden /> {m.name}
                </span>
              )}
              <span className="vh-row-bar" aria-hidden>
                <span style={{ width: `${((m.count ?? 0) / m.worst) * 100}%` }} />
              </span>
              <span className={`tabular vh-row-n ${m.count ? '' : 'ok-text'}`}>{m.count == null ? '—' : fmt(m, m.count)}</span>
            </div>
            {m.people.length > 0 && (
              <div className="vh-metric-people">
                {m.people.map((p) => (
                  <span key={p.guid} className="who-chip" style={{ color: classColor(p.class) }}>
                    {shortName(p.name)} <span className="muted">{fmt(m, p.count)}</span>
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- CDs da note de cura

type Issue = { check: LineCheck; spellId: number | null; name: string; cls: string | null; guid: string | undefined };

/**
 * CDs da note no try visto: quantos saíram na hora (barra) e, um por linha, quem não usou, usou
 * antes ou depois da hora, ou estava morto. Mesma conferência da aba CDs de cura.
 */
export function NoteCds({ pulls, pull, onPlay }: { pulls: Pull[]; pull: Pull; onPlay?: (t: number, guid?: string) => void }) {
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
              {onPlay && c.expectedMs != null ? <PlayAt onPlay={() => onPlay(c.expectedMs!, guid)} /> : <span />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
