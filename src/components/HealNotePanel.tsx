import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Copy, HeartPulse, Play } from 'lucide-react';
import type { PlayerStats, Pull } from '../types';
import { mmss, shortName } from '../lib/format';
import { healCd } from '../lib/healCooldowns';
import { progressLabel } from '../lib/phases';
import { selectHealRefs } from '../lib/healer';
import { exportNote, mapPhases, noteFor, noteVersions, parseNote, type NoteChange, type NoteLine, type NoteVersion, type ParsedNote } from '../lib/healNote';
import { effectiveCooldowns, judgeUse, matchLines, nightOverheal, phaseOffsets, suggest, summarizeLines, type LineCheck, type NightOverheal, type NoteSuggestion, type UseVerdict } from '../lib/healNoteCheck';
import { defaultPull, gaps as computeGaps, nightGaps as computeNightGaps, uses as computeUses, withNote } from '../lib/healTimeline';
import { hits as computeHits, moments, nightAnchors, raidLow, type Moment } from '../lib/raidHits';
import { HealTimeline } from './HealTimeline';
import { NoteBox } from './NoteBox';
import { PlayerName } from './Names';
import { SpellIcon, SpellName } from './SpellIcon';
import { Hint } from './ui/Hint';
import { useMessages } from '../i18n';
import { healNoteMsg } from './HealNotePanel.i18n';

interface Props {
  /** pulls do mesmo boss e dificuldade na noite */
  pulls: Pull[];
  /** aba do pull: mostra só este pull (os outros entram no desvio de fase) */
  focus?: Pull;
  live?: boolean;
  /** ▶: abre o replay do pull nesse instante (só quando o replay completo pode ser carregado) */
  onReplay?: (t: number) => void;
  /** resumo da noite: o painel recolhe e expande (a escolha fica no navegador) */
  collapsible?: boolean;
}

const OPEN_KEY = 'wipe-cause:heal-note-open';
function savedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/** referências de fora do healer (análise de healer, docs/healer-analysis.md §2) */
const refsOf = (p: Pull, pl: PlayerStats) => selectHealRefs(p, pl)?.entries ?? [];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} s`;
const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');

/** A note de CDs de cura do líder conferida contra os pulls (regras em docs/heal-cd-note.md). */
export function HealNotePanel({ pulls, focus, live = false, onReplay, collapsible = false }: Props) {
  const t = useMessages(healNoteMsg);
  const [expanded, setExpanded] = useState(savedOpen);
  const open = !collapsible || expanded;
  const toggle = () => {
    setExpanded(!expanded);
    try {
      localStorage.setItem(OPEN_KEY, expanded ? '0' : '1');
    } catch {
      // sem localStorage: vale só nesta tela
    }
  };
  const boss = focus ?? pulls[0];
  const [versions, setVersions] = useState<NoteVersion[]>(() => (boss ? noteVersions(boss) : []));
  // pull escolhido na fileira do resumo da noite (volta ao padrão quando o conjunto de pulls muda)
  const [picked, setPicked] = useState<Pull | null>(() => (pulls.length ? defaultPull(pulls) : null));
  const pullIds = pulls.map((p) => p.id).join(',');
  const [focusAt, setFocusAt] = useState<number | undefined>(undefined);
  const [detailsOpen, setDetailsOpen] = useState(() => versions.length > 0);
  const hadVersions = useRef(versions.length > 0);
  useEffect(() => {
    setPicked(pulls.length ? defaultPull(pulls) : null);
  }, [pullIds]);
  useEffect(() => {
    if (!hadVersions.current && versions.length > 0) setDetailsOpen(true);
    hadVersions.current = versions.length > 0;
  }, [versions.length]);

  const parsed = useMemo(() => new Map(versions.map((v) => [v.savedAt, parseNote(v.text)])), [versions]);
  const versionOf = useMemo(() => new Map(pulls.map((p) => [p.id, noteFor(p, pulls, versions)])), [pulls, versions]);
  const noteOf = useMemo(
    () =>
      (p: Pull): ParsedNote | null => {
        const v = versionOf.get(p.id);
        return v ? (parsed.get(v.savedAt) ?? null) : null;
      },
    [versionOf, parsed],
  );
  const offsets = useMemo(() => phaseOffsets(pulls, noteOf), [pulls, noteOf]);
  const checks = useMemo(() => matchLines(pulls, noteOf, offsets), [pulls, noteOf, offsets]);
  // golpes do boss e momentos da noite (não dependem da note) e os veredictos de uso
  const anchors = useMemo(() => nightAnchors(pulls), [pulls]);
  const hitsByPull = useMemo(() => new Map(pulls.map((p) => [p.id, computeHits(p, anchors.get(p.id) ?? {})] as const)), [pulls, anchors]);
  const ms = useMemo(() => moments(pulls, anchors, hitsByPull), [pulls, anchors, hitsByPull]);
  const verdicts = useMemo(() => judgeUse(pulls, noteOf, offsets, checks, ms, refsOf), [pulls, noteOf, offsets, checks, ms]);
  const nightOH = useMemo(() => new Map(nightOverheal(pulls, noteOf, verdicts, checks, refsOf).map((o) => [`${o.guid}:${o.cdId}`, o])), [pulls, noteOf, verdicts, checks]);
  const lows = useMemo(() => new Map(pulls.map((p) => [p.id, raidLow(p)] as const)), [pulls]);
  const effectiveCds = useMemo(() => effectiveCooldowns(pulls), [pulls]);
  const baseUses = useMemo(
    () => new Map(pulls.map((p) => [p.id, computeUses(p, ms, hitsByPull.get(p.id) ?? [], refsOf, true, effectiveCds)] as const)),
    [pulls, ms, hitsByPull, effectiveCds],
  );
  const usedInNight = useMemo(() => new Set([...baseUses.values()].flatMap((us) => us.map((u) => `${u.player.guid}:${u.cd.id}`))), [baseUses]);
  const usesByPull = useMemo(
    () =>
      new Map(
        pulls.map((p) => {
          const us = baseUses.get(p.id) ?? [];
          const note = noteOf(p);
          return [p.id, note ? withNote(p, us, note, checks.get(p.id) ?? [], verdicts.get(p.id) ?? null) : { uses: us, marks: [] }] as const;
        }),
      ),
    [pulls, baseUses, noteOf, checks, verdicts],
  );
  const gapsByPull = useMemo(
    () => new Map(pulls.map((p) => [p.id, computeGaps(p, usesByPull.get(p.id)!.uses, anchors.get(p.id) ?? {}, hitsByPull.get(p.id) ?? [], usedInNight)] as const)),
    [pulls, usesByPull, anchors, hitsByPull, usedInNight],
  );
  const nightGapList = useMemo(() => computeNightGaps(pulls, anchors, gapsByPull), [pulls, anchors, gapsByPull]);
  const totalUses = [...baseUses.values()].reduce((n, us) => n + us.length, 0);
  const enemyNames = useMemo(() => new Map(pulls.flatMap((p) => p.enemySpells.map((e) => [e.spellId, e.name] as const))), [pulls]);
  // nome e classe de cada player e o nome de cada spell, como aparecem nos pulls
  const people = useMemo(() => {
    const m = new Map<string, { name: string; guid: string; cls: string | null }>();
    for (const p of pulls) for (const x of p.players) m.set(norm(shortName(x.name)), { name: x.name, guid: x.guid, cls: x.class });
    return m;
  }, [pulls]);
  const spellNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of pulls) for (const x of p.players) for (const c of x.casts ?? []) if (c.name) m.set(c.spellId, c.name);
    return m;
  }, [pulls]);
  const nameOf = (id: number) => spellNames.get(id) ?? healCd(id)?.name ?? `#${id}`;

  if (!boss) return null;
  const selected = focus ?? (picked && pulls.some((p) => p.id === picked.id) ? picked : defaultPull(pulls));
  const sel = usesByPull.get(selected.id) ?? { uses: [], marks: [] };
  const selGaps = gapsByPull.get(selected.id) ?? [];
  const selHits = hitsByPull.get(selected.id) ?? [];
  const selLow = lows.get(selected.id) ?? [];
  const selAnchors = anchors.get(selected.id) ?? {};
  const shownPulls = focus ? [focus] : pulls;
  // uma tabela por versão que julgou algum pull mostrado
  const groups = new Map<number, Pull[]>();
  for (const p of shownPulls) {
    const v = versionOf.get(p.id);
    if (v) (groups.get(v.savedAt) ?? groups.set(v.savedAt, []).get(v.savedAt)!).push(p);
  }
  const newest = versions[versions.length - 1];
  const newestNote = newest ? parsed.get(newest.savedAt) : undefined;
  const header = newestNote?.header;
  const mismatch = header && ((header.encounterId != null && header.encounterId !== boss.encounterId) || (header.difficulty && norm(header.difficulty) !== norm(boss.difficultyName)));
  const unknown = [...new Set((newestNote?.lines ?? []).filter((l) => l.tag && norm(l.tag) !== 'everyone' && l.spellId != null && !people.has(norm(l.tag))).map((l) => l.tag!))];
  const phaseNames = new Map<string, string>();
  for (const p of pulls) for (const [ph, m] of mapPhases(p.phaseMarks)) if (!phaseNames.has(ph)) phaseNames.set(ph, m.name);
  // fase da note (ph) de cada fase da regra, para escrever os momentos no relógio da note
  const phOfKey = new Map<string, string>();
  for (const p of pulls) for (const [ph, m] of mapPhases(p.phaseMarks)) if (!phOfKey.has(m.key)) phOfKey.set(m.key, ph);
  const noteTime = (m: Moment) => {
    const ph = phOfKey.get(m.phaseKey) ?? '1';
    const o = offsets.get(ph);
    return { ph, ms: m.inPhaseMs - (o?.applied ? o.offsetMs : 0), appClock: !!o && !o.applied && !o.first };
  };
  const noSeries = shownPulls.some((p) => !p.raidSeries?.low);
  const notePhs = [...new Set((newestNote?.lines ?? []).filter((l) => l.ph != null).map((l) => l.ph!))].sort((a, b) => Number(a) - Number(b));

  return (
    <section className="panel heal-note">
      <header className="assign-head">
        <h3>
          <HeartPulse size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.title} <Hint>{t.hint}</Hint>
        </h3>
        {collapsible && (
          <button className="btn ghost sm" onClick={toggle} aria-expanded={open} aria-label={open ? t.collapse : t.expand} title={open ? t.collapse : t.expand}>
            {open ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden />} {open ? t.collapse : t.expand}
          </button>
        )}
      </header>
      {open && (
        <>
          {!focus && (
            <div className="heal-tl-pulls">
              {pulls.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={selected.id === p.id ? 'selected' : ''}
                  title={`${mmss(p.durationMs)} · ${progressLabel(p)}`}
                  onClick={() => {
                    setPicked(p);
                    setFocusAt(undefined);
                  }}
                >
                  #{p.pullNumber} {progressLabel(p)}
                </button>
              ))}
            </div>
          )}
          {totalUses === 0 && <p className="muted small">{t.noCds}</p>}
          {!selected.raidSeries?.low && <p className="muted small">{t.noLife}</p>}
          <HealTimeline
            pull={selected}
            uses={sel.uses}
            marks={sel.marks}
            gaps={selGaps}
            hits={selHits}
            low={selLow}
            bossCasts={selAnchors}
            onReplay={focus ? onReplay : undefined}
            focusAt={focusAt}
          />
          {selGaps.length > 0 && (
            <>
              <p className="small muted">{focus ? t.gapsPull : t.gapsNight}</p>
              <div className="heal-tl-cards">
                {focus
                  ? selGaps.map((g, i) => {
                      const spellId = g.key ? Number(g.key.split(':')[0]) : null;
                      return (
                        <button key={`${g.start}-${g.end}`} type="button" className="heal-tl-card" onClick={() => setFocusAt(g.start)}>
                          <span>{t.tlGapTip(i + 1, pct(g.peak))}</span>
                          {spellId != null && <SpellName spellId={spellId} name={enemyNames.get(spellId) ?? nameOf(spellId)} size={14} />}
                          {g.free.length > 0 && (
                            <span>
                              {g.free.map(({ player, cd }) => (
                                <SpellIcon key={`${player.guid}:${cd.id}`} spellId={cd.id} size={14} title={cd.name} hover={false} />
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    })
                  : nightGapList.map((ng) => {
                      const here = selGaps.find((g) => g.key === ng.key);
                      const pullsWith = pulls.filter((p) => ng.pulls.has(p.id)).sort((a, b) => b.startMs - a.startMs);
                      const newest = pullsWith[0];
                      const target = here ? selected : newest;
                      const gap = target ? (gapsByPull.get(target.id) ?? []).find((g) => g.key === ng.key) : undefined;
                      const free: { player: PlayerStats; cd: { id: number; name: string } }[] = [];
                      const seen = new Set<string>();
                      for (const p of pullsWith)
                        for (const g of gapsByPull.get(p.id) ?? [])
                          if (g.key === ng.key)
                            for (const f of g.free) {
                              const k = `${f.player.guid}:${f.cd.id}`;
                              if (seen.has(k)) continue;
                              seen.add(k);
                              free.push(f);
                            }
                      return (
                        <button
                          key={ng.key}
                          type="button"
                          className="heal-tl-card"
                          onClick={() => {
                            if (!here && newest) setPicked(newest);
                            setFocusAt(gap?.start ?? 0);
                          }}
                        >
                          <SpellName spellId={ng.spellId} name={enemyNames.get(ng.spellId) ?? nameOf(ng.spellId)} size={14} />
                          <span className="muted small">{t.gapCard(ng.pulls.size, ng.reached)}</span>
                          {free.length > 0 && (
                            <span>
                              {free.map(({ player, cd }) => (
                                <SpellIcon key={`${player.guid}:${cd.id}`} spellId={cd.id} size={14} title={cd.name} hover={false} />
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    })}
              </div>
            </>
          )}

          <details className="heal-note-details" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
            <summary>{t.details}</summary>
            <NoteBox pull={boss} nightPulls={pulls} live={live} versions={versions} onChange={setVersions} placeholder={t.paste} />

            {mismatch && <p className="warn small">{t.headerMismatch(header?.name ?? '')}</p>}
            {unknown.length > 0 && <p className="muted small">{t.unknownTags(unknown.join(', '))}</p>}

            {notePhs.length > 0 && (
            <p className="small heal-note-phases">
              <span className="muted">
                {t.phases} <Hint>{t.offsetHint}</Hint>:
              </span>{' '}
              {notePhs.map((ph, i) => {
                const o = offsets.get(ph);
                return (
                  <span key={ph}>
                    {i > 0 && ' · '}
                    <strong>ph:{ph}</strong> = {phaseNames.get(ph) || (phaseNames.has(ph) ? `P${ph}` : <span className="muted">{t.noPair}</span>)}
                    {o && !o.first && (
                      <span className={o.applied ? '' : 'muted'}>
                        {' '}
                        ({t.offset(sec(o.offsetMs))}, {o.applied ? t.applied : t.notApplied})
                      </span>
                    )}
                    {o?.first && <span className="muted"> ({t.first})</span>}
                  </span>
                );
              })}
            </p>
          )}

          {focus && versions.length > 0 && !versionOf.get(focus.id) && <p className="muted small">{t.noVersion}</p>}
          {noSeries && <p className="muted small">{t.reanalyze}</p>}

          {[...groups.entries()].map(([savedAt, ps]) => {
            const note = parsed.get(savedAt);
            if (!note) return null;
            const idx = versions.findIndex((v) => v.savedAt === savedAt) + 1;
            const summary = new Map(summarizeLines(checks, ps).map((s) => [s.lineIndex, s]));
            const one = focus ? new Map((checks.get(focus.id) ?? []).map((c) => [c.lineIndex, c])) : null;
            const uses = new Map<number, UseVerdict[]>();
            for (const p of ps) for (const [i, v] of verdicts.get(p.id)?.lines ?? []) (uses.get(i) ?? uses.set(i, []).get(i)!).push(v);
            const misses = new Map<number, MissCounts>();
            for (const p of ps)
              for (const c of checks.get(p.id) ?? []) {
                if (c.state !== 'not_used' || !c.miss) continue;
                const m = misses.get(c.lineIndex) ?? {};
                m[c.miss] = (m[c.miss] ?? 0) + 1;
                misses.set(c.lineIndex, m);
              }
            const ohOf = (l: NoteLine) => {
              const who = l.tag ? people.get(norm(l.tag)) : undefined;
              const cd = l.spellId != null ? healCd(l.spellId) : undefined;
              return who && cd ? nightOH.get(`${who.guid}:${cd.id}`) : undefined;
            };
            return (
              <div key={savedAt} className="heal-note-version">
                {!focus && <h4 className="recap-title">{t.versionOf(idx, ps.length)}</h4>}
                <table className="players heal-note-table">
                  <thead>
                    <tr>
                      <th>{t.when}</th>
                      <th>{t.who}</th>
                      <th>{t.cd}</th>
                      <th>{t.result}</th>
                      <th className="num">
                        {t.delta} <Hint>{t.deltaHint}</Hint>
                      </th>
                      <th>
                        {t.useCol} <Hint>{t.useHint}</Hint>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.lines.map((l, i) =>
                      l.ph == null ? null : (
                        <Row key={i} line={l} check={one?.get(i)} summary={summary.get(i)} uses={uses.get(i) ?? []} misses={misses.get(i)} night={ohOf(l)} focus={!!focus} person={l.tag ? people.get(norm(l.tag)) : undefined} spellName={l.spellId != null ? nameOf(l.spellId) : ''} />
                      ),
                    )}
                  </tbody>
                </table>
                {!focus && (
                  <Suggestion
                    note={note}
                    s={suggest(note, ps, offsets, checks, ms, verdicts, refsOf)}
                    moment={(key) => {
                      const m = ms.find((x) => x.key === key)!;
                      const nt = noteTime(m);
                      return (
                        <>
                          P{nt.ph} +{mmss(Math.max(0, nt.ms))} · <SpellName spellId={m.spellId ?? m.anchorSpell} name={enemyNames.get(m.spellId ?? m.anchorSpell) ?? `#${m.spellId}`} size={16} />{' '}
                          <span className="muted small">{t.afterCast(enemyNames.get(m.anchorSpell) ?? '', m.k)}</span>
                        </>
                      );
                    }}
                    person={(guid) => [...people.values()].find((x) => x.guid === guid)}
                    nameOf={nameOf}
                  />
                )}
              </div>
            );
          })}

          {ms.length > 0 && (
            <div className="heal-note-version">
              <h4 className="recap-title">
                {t.hitsTitle} <Hint>{t.hitsHint}</Hint>
              </h4>
              <table className="players heal-note-table">
                <thead>
                  <tr>
                    <th>{t.when}</th>
                    <th>{t.skill}</th>
                    <th>{t.hitIn}</th>
                    <th className="num">{t.size}</th>
                    <th>{t.covered}</th>
                  </tr>
                </thead>
                <tbody>
                  {ms
                    .filter((m) => shownPulls.some((p) => m.pulls.has(p.id)))
                    .map((m) => {
                      const nt = noteTime(m);
                      const reached = shownPulls.filter((p) => m.pulls.has(p.id));
                      const uncovered = reached.filter((p) => verdicts.get(p.id)?.uncovered.includes(m.key)).length;
                      const here = focus ? m.pulls.get(focus.id) : undefined;
                      return (
                        <tr key={m.key}>
                          <td className="muted">
                            P{nt.ph} +{mmss(Math.max(0, nt.ms))}
                            {nt.appClock && <span className="muted"> ({t.appClock})</span>}
                          </td>
                          <td>
                            <SpellName spellId={m.spellId ?? m.anchorSpell} name={enemyNames.get(m.spellId ?? m.anchorSpell) ?? `#${m.spellId}`} size={16} />{' '}
                            <span className="muted small">{t.afterCast(enemyNames.get(m.anchorSpell) ?? '', m.k)}</span>
                          </td>
                          <td className="muted">{focus ? (here?.hit ? t.yes : t.belowLimit) : t.hitOf(m.withHit, m.pulls.size)}</td>
                          <td className="num muted">{m.medianSize != null ? `${Math.round(m.medianSize * 100)}%` : ''}</td>
                          <td>
                            {focus ? (
                              <span className={uncovered ? 'bad' : 'ok-text'}>{uncovered ? t.noCd : t.withCd}</span>
                            ) : (
                              <span className={uncovered ? 'bad' : 'ok-text'}>{t.uncoveredOf(uncovered, reached.length)}</span>
                            )}
                            {focus && here && onReplay && (
                              <button className="btn ghost sm" title={t.play} aria-label={t.play} onClick={() => onReplay(here.at)}>
                                <Play size={12} aria-hidden />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {(() => {
            const lows = shownPulls.flatMap((p) => (verdicts.get(p.id)?.lowWithoutHit ?? []).map((e) => ({ p, e })));
            if (!lows.length) return null;
            return (
              <p className="small">
                <strong>{t.lowTitle}</strong> <Hint>{t.lowHint}</Hint>:{' '}
                {focus
                  ? lows.map(({ e }, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {mmss(e.start)}–{mmss(e.end)}
                        {onReplay && (
                          <button className="btn ghost sm" title={t.play} aria-label={t.play} onClick={() => onReplay(e.start)}>
                            <Play size={12} aria-hidden />
                          </button>
                        )}
                      </span>
                    ))
                  : t.lowCount(lows.length, new Set(lows.map((x) => x.p.id)).size)}
              </p>
            );
          })()}
          </details>
        </>
      )}
    </section>
  );
}

const GOOD = new Set(['on_time']);
const BAD = new Set(['not_used', 'early', 'late']);
type MissCounts = Partial<Record<NonNullable<LineCheck['miss']>, number>>;
const MISS_ORDER: NonNullable<LineCheck['miss']>[] = ['recharging', 'used_elsewhere', 'never'];

interface RowProps {
  line: NoteLine;
  check?: LineCheck;
  uses: UseVerdict[];
  summary?: ReturnType<typeof summarizeLines>[number];
  /** contagem de causas do "não usou" na noite */
  misses?: MissCounts;
  /** overheal da noite do player com esse CD */
  night?: NightOverheal;
  focus: boolean;
  person?: { name: string; guid: string; cls: string | null };
  spellName: string;
}

function Row({ line, check, summary, uses, misses, night, focus, person, spellName }: RowProps) {
  const t = useMessages(healNoteMsg);
  const when = `P${line.ph} +${mmss((line.time ?? 0) * 1000)}`;
  const who = person ? <PlayerName name={person.name} guid={person.guid} cls={person.cls} /> : <span className="muted">{line.tag ?? '—'}</span>;
  const what = line.spellId != null ? <SpellName spellId={line.spellId} name={spellName} size={16} /> : <span className="muted">{line.text ?? ''}</span>;
  const missText = (c: LineCheck) => {
    if (c.miss === 'recharging' && c.lastUseMs != null && c.readyMs != null) return t.missRecharging(c.lastUseMs, c.readyMs);
    if (c.miss === 'used_elsewhere' && c.otherUseMs != null) return t.missElsewhere(c.otherUseMs - (c.expectedMs ?? 0));
    if (c.miss === 'never') return t.missNever;
    return null;
  };
  const shortMiss: Record<NonNullable<LineCheck['miss']>, string> = {
    recharging: t.missRechargingShort,
    used_elsewhere: t.missElsewhereShort,
    never: t.missNeverShort,
  };
  let result: ReactNode = <span className="muted">{t.state.not_evaluated}</span>;
  let delta: ReactNode = '';
  if (focus && check) {
    const cls = GOOD.has(check.state) ? 'ok-text' : BAD.has(check.state) || check.state === 'dead' ? 'bad' : 'muted';
    const cause = check.state === 'not_used' ? missText(check) : null;
    result = (
      <>
        <span className={cls}>
          {t.state[check.state]}
          {check.neverUsed && <span className="muted"> · {t.neverUsed}</span>}
        </span>
        {cause && <span className="muted small"> · {cause}</span>}
      </>
    );
    if (check.deltaMs != null) delta = `${sec(check.deltaMs)}${check.rawDeltaMs != null && check.rawDeltaMs !== check.deltaMs ? ` (${sec(check.rawDeltaMs)})` : ''}`;
  } else if (!focus && summary) {
    if (summary.reached > 0) {
      result = (
        <span className={summary.onTime === summary.reached ? 'ok-text' : summary.onTime < summary.reached / 2 ? 'bad' : ''}>
          {t.onTimeOf(summary.onTime, summary.reached)}
          {summary.notUsed > 0 && (
            <span className="muted">
              {' · '}
              {t.state.not_used} {summary.notUsed}
              {MISS_ORDER.map((k) => {
                const n = misses?.[k] ?? 0;
                return n > 0 ? <span key={k}> · {n} {shortMiss[k]}</span> : null;
              })}
            </span>
          )}
          {summary.dead > 0 && <span className="muted"> · {t.state.dead} {summary.dead}</span>}
        </span>
      );
    } else {
      const top = Object.entries(summary.states).sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof t.state | undefined;
      result = <span className="muted">{top ? t.state[top] : t.state.not_evaluated}</span>;
    }
    if (summary.medianDeltaMs != null) delta = sec(summary.medianDeltaMs);
  }
  return (
    <tr>
      <td className="muted">{when}</td>
      <td>{who}</td>
      <td>{what}</td>
      <td>{result}</td>
      <td className="num muted">{delta}</td>
      <td>
        <UseCell uses={uses} night={night} focus={focus} />
      </td>
    </tr>
  );
}

/** "No golpe", "fora do golpe", "sem dano", overheal, "empilhado" e "uso de ciclo" (um pull, ou a soma da noite). */
function UseCell({ uses, night, focus }: { uses: UseVerdict[]; night?: NightOverheal; focus: boolean }) {
  const t = useMessages(healNoteMsg);
  if (!uses.length) return null;
  if (uses.some((u) => u.cycle)) return <span className="muted">{t.cycle}</span>;
  const withMoment = uses.filter((u) => u.momentKey && u.onHit != null);
  const onHit = withMoment.filter((u) => u.onHit).length;
  const noDamage = uses.filter((u) => u.noDamage).length;
  const parts: ReactNode[] = [];
  if (withMoment.length)
    parts.push(
      focus ? (
        <span key="h" className={onHit ? 'ok-text' : 'bad'}>
          {onHit ? t.onHit : t.offHit}
        </span>
      ) : (
        <span key="h" className={onHit === withMoment.length ? 'ok-text' : onHit < withMoment.length / 2 ? 'bad' : ''}>
          {t.onHitOf(onHit, withMoment.length)}
        </span>
      ),
    );
  if (noDamage)
    parts.push(
      <span key="d" className="bad">
        {focus ? t.noDamage : t.noDamageOf(noDamage)}
      </span>,
    );
  // overheal: no pull, o uso contra as referências e a noite ao lado, sem cor; na noite, a soma dos usos
  const oh = focus ? uses.find((u) => u.overheal)?.overheal : null;
  const band = (b: { p25: number; p75: number } | null) => (b ? ` (${t.refBand(pct(b.p25), pct(b.p75))})` : '');
  if (oh)
    parts.push(
      <span key="o" className={oh.high ? 'bad' : ''} title={t.overhealHint}>
        {t.overheal(pct(oh.share))}
        {band(oh.ref)}
        {night && <span className="muted"> · {t.nightAvg(pct(night.share))}</span>}
      </span>,
    );
  else if (!focus && night && uses.some((u) => u.overheal))
    parts.push(
      <span key="o" className={night.high ? 'bad' : ''} title={t.overhealHint}>
        {t.overheal(pct(night.share))}
        {band(night.ref)}
      </span>,
    );
  const stacked = uses.filter((u) => u.stacked).length;
  if (stacked)
    parts.push(
      <span key="s" className="bad" title={t.stackedHint}>
        {focus ? t.stacked : t.stackedOf(stacked)}
      </span>,
    );
  if (!parts.length) return <span className="muted">—</span>;
  return <>{parts.reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}</>;
}

interface SuggestionProps {
  note: ParsedNote;
  s: NoteSuggestion;
  moment: (key: string) => ReactNode;
  person: (guid: string) => { name: string; guid: string; cls: string | null } | undefined;
  nameOf: (id: number) => string;
}

/** Note sugerida de uma versão: cada mudança com o motivo e uma caixa; "Copiar" exporta só as marcadas. */
function Suggestion({ note, s, moment, person, nameOf }: SuggestionProps) {
  const t = useMessages(healNoteMsg);
  // mover: `m<linha>`; adicionar: `a<golpe>:<candidato>` (um candidato por golpe)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  // sem acesso à área de transferência: a note fica numa caixa para copiar à mão
  const [manual, setManual] = useState<string | null>(null);
  const toggle = (id: string, group?: string) => {
    setCopied(false);
    setManual(null);
    setPicked((old) => {
      const next = new Set([...old].filter((x) => !group || !x.startsWith(group)));
      if (!old.has(id)) next.add(id);
      return next;
    });
  };
  const changes: NoteChange[] = [
    ...s.moves.filter((m) => picked.has(`m${m.change.line}`)).map((m) => m.change),
    ...s.adds.flatMap((a, i) => a.candidates.filter((_, j) => picked.has(`a${i}:${j}`)).map((c) => c.change)),
  ];
  const who = (guid: string, tag: string) => {
    const p = person(guid);
    return p ? <PlayerName name={p.name} guid={p.guid} cls={p.cls} /> : <span>{tag}</span>;
  };
  const copy = async () => {
    const text = exportNote(note, changes);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setManual(text);
    }
  };
  if (!s.adds.length && !s.moves.length)
    return (
      <p className="muted small">
        {t.suggestTitle}: {t.noSuggestion}
      </p>
    );
  return (
    <div className="heal-note-suggest">
      <h4 className="recap-title">
        {t.suggestTitle} <Hint>{t.suggestHint}</Hint>
      </h4>
      <ul className="heal-note-changes">
        {s.adds.map((a, i) => (
          <li key={`a${i}`}>
            <div>
              <span className="bad">{t.uncoveredHit}</span> {moment(a.reason.momentKey)}{' '}
              <span className="muted small">· {t.reason(a.reason.pulls, a.reason.reached, a.reason.medianSize != null ? pct(a.reason.medianSize) : '')}</span>
            </div>
            {a.candidates.map((c, j) => (
              <label key={j} className="heal-note-change">
                <input type="checkbox" checked={picked.has(`a${i}:${j}`)} onChange={() => toggle(`a${i}:${j}`, `a${i}:`)} /> {t.add} <SpellName spellId={c.cdId} name={nameOf(c.cdId)} size={16} />{' '}
                {who(c.guid, c.change.tag)}{' '}
                <span className="muted">
                  P{c.change.ph} +{mmss(c.change.time * 1000)}
                  {c.refs > 0 && <> · {t.refsAt(c.refs)}</>}
                </span>
              </label>
            ))}
          </li>
        ))}
        {s.moves.map((m) => {
          const l = note.lines[m.change.line];
          return (
            <li key={`m${m.change.line}`}>
              <label className="heal-note-change">
                <input type="checkbox" checked={picked.has(`m${m.change.line}`)} onChange={() => toggle(`m${m.change.line}`)} /> {t.move}{' '}
                {l.spellId != null && <SpellName spellId={l.spellId} name={nameOf(l.spellId)} size={16} />} {who(m.guid, l.tag ?? '')}{' '}
                <span className="muted">
                  P{l.ph} +{mmss((l.time ?? 0) * 1000)} → +{mmss(m.change.time * 1000)}
                </span>
              </label>
              <div className="muted small heal-note-why">
                {moment(m.reason.momentKey)} · {t.moveReason(m.reason.pulls, m.reason.reached)}
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn sm" onClick={copy} disabled={!changes.length}>
        <Copy size={12} aria-hidden /> {copied ? t.copied : t.copy(changes.length)}
      </button>
      {manual != null && (
        <div className="heal-note-manual">
          <p className="muted small">{t.copyManual}</p>
          <textarea className="text-input" rows={8} readOnly value={manual} spellCheck={false} autoFocus onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
