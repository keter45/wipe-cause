import { useMemo, useState, type ReactNode } from 'react';
import { Copy, HeartPulse, Play } from 'lucide-react';
import type { PlayerStats, Pull } from '../types';
import { mmss, shortName } from '../lib/format';
import { healCd } from '../lib/healCooldowns';
import { selectHealRefs } from '../lib/healer';
import { exportNote, mapPhases, noteFor, noteVersions, parseNote, type NoteChange, type NoteLine, type NoteVersion, type ParsedNote } from '../lib/healNote';
import { judgeUse, matchLines, nightOverheal, phaseOffsets, suggest, summarizeLines, type LineCheck, type NightOverheal, type NoteSuggestion, type UseVerdict } from '../lib/healNoteCheck';
import { hits, moments, nightAnchors, type Moment } from '../lib/raidHits';
import { NoteBox } from './NoteBox';
import { PlayerName } from './Names';
import { SpellName } from './SpellIcon';
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
}

/** referências de fora do healer (análise de healer, docs/healer-analysis.md §2) */
const refsOf = (p: Pull, pl: PlayerStats) => selectHealRefs(p, pl)?.entries ?? [];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} s`;
const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');

/** A note de CDs de cura do líder conferida contra os pulls (regras em docs/heal-cd-note.md). */
export function HealNotePanel({ pulls, focus, live = false, onReplay }: Props) {
  const t = useMessages(healNoteMsg);
  const boss = focus ?? pulls[0];
  const [versions, setVersions] = useState<NoteVersion[]>(() => (boss ? noteVersions(boss) : []));

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
  const ms = useMemo(() => {
    const anchors = nightAnchors(pulls);
    return moments(pulls, anchors, new Map(pulls.map((p) => [p.id, hits(p, anchors.get(p.id) ?? {})])));
  }, [pulls]);
  const verdicts = useMemo(() => judgeUse(pulls, noteOf, offsets, checks, ms, refsOf), [pulls, noteOf, offsets, checks, ms]);
  const nightOH = useMemo(() => new Map(nightOverheal(pulls, noteOf, verdicts, checks, refsOf).map((o) => [`${o.guid}:${o.cdId}`, o])), [pulls, noteOf, verdicts, checks]);
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
      </header>
      <NoteBox pull={boss} nightPulls={pulls} live={live} versions={versions} onChange={setVersions} placeholder={t.paste} />

      {!versions.length && <p className="muted small">{t.empty}</p>}
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
                    <Row key={i} line={l} check={one?.get(i)} summary={summary.get(i)} uses={uses.get(i) ?? []} night={ohOf(l)} focus={!!focus} person={l.tag ? people.get(norm(l.tag)) : undefined} spellName={l.spellId != null ? nameOf(l.spellId) : ''} />
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
    </section>
  );
}

const GOOD = new Set(['on_time']);
const BAD = new Set(['not_used', 'early', 'late']);

interface RowProps {
  line: NoteLine;
  check?: LineCheck;
  uses: UseVerdict[];
  summary?: ReturnType<typeof summarizeLines>[number];
  /** overheal da noite do player com esse CD */
  night?: NightOverheal;
  focus: boolean;
  person?: { name: string; guid: string; cls: string | null };
  spellName: string;
}

function Row({ line, check, summary, uses, night, focus, person, spellName }: RowProps) {
  const t = useMessages(healNoteMsg);
  const when = `P${line.ph} +${mmss((line.time ?? 0) * 1000)}`;
  const who = person ? <PlayerName name={person.name} guid={person.guid} cls={person.cls} /> : <span className="muted">{line.tag ?? '—'}</span>;
  const what = line.spellId != null ? <SpellName spellId={line.spellId} name={spellName} size={16} /> : <span className="muted">{line.text ?? ''}</span>;
  let result: ReactNode = <span className="muted">{t.state.not_evaluated}</span>;
  let delta: ReactNode = '';
  if (focus && check) {
    const cls = GOOD.has(check.state) ? 'ok-text' : BAD.has(check.state) || check.state === 'dead' ? 'bad' : 'muted';
    result = (
      <span className={cls}>
        {t.state[check.state]}
        {check.neverUsed && <span className="muted"> · {t.neverUsed}</span>}
      </span>
    );
    if (check.deltaMs != null) delta = `${sec(check.deltaMs)}${check.rawDeltaMs != null && check.rawDeltaMs !== check.deltaMs ? ` (${sec(check.rawDeltaMs)})` : ''}`;
  } else if (!focus && summary) {
    if (summary.reached > 0) {
      result = (
        <span className={summary.onTime === summary.reached ? 'ok-text' : summary.onTime < summary.reached / 2 ? 'bad' : ''}>
          {t.onTimeOf(summary.onTime, summary.reached)}
          {summary.notUsed > 0 && <span className="muted"> · {t.state.not_used} {summary.notUsed}</span>}
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
