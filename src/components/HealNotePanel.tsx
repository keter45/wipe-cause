import { useMemo, useState, type ReactNode } from 'react';
import { HeartPulse } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, shortName } from '../lib/format';
import { healCd } from '../lib/healCooldowns';
import { mapPhases, noteFor, noteVersions, parseNote, type NoteLine, type NoteVersion, type ParsedNote } from '../lib/healNote';
import { matchLines, phaseOffsets, summarizeLines, type LineCheck } from '../lib/healNoteCheck';
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
}

const sec = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(1)} s`;
const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');

/** A note de CDs de cura do líder conferida contra os pulls (regras em docs/heal-cd-note.md). */
export function HealNotePanel({ pulls, focus, live = false }: Props) {
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

      {[...groups.entries()].map(([savedAt, ps]) => {
        const note = parsed.get(savedAt);
        if (!note) return null;
        const idx = versions.findIndex((v) => v.savedAt === savedAt) + 1;
        const summary = new Map(summarizeLines(checks, ps).map((s) => [s.lineIndex, s]));
        const one = focus ? new Map((checks.get(focus.id) ?? []).map((c) => [c.lineIndex, c])) : null;
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
                </tr>
              </thead>
              <tbody>
                {note.lines.map((l, i) =>
                  l.ph == null ? null : (
                    <Row key={i} line={l} check={one?.get(i)} summary={summary.get(i)} focus={!!focus} person={l.tag ? people.get(norm(l.tag)) : undefined} spellName={l.spellId != null ? nameOf(l.spellId) : ''} />
                  ),
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

const GOOD = new Set(['on_time']);
const BAD = new Set(['not_used', 'early', 'late']);

interface RowProps {
  line: NoteLine;
  check?: LineCheck;
  summary?: ReturnType<typeof summarizeLines>[number];
  focus: boolean;
  person?: { name: string; guid: string; cls: string | null };
  spellName: string;
}

function Row({ line, check, summary, focus, person, spellName }: RowProps) {
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
    </tr>
  );
}
