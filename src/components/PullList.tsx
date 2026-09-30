import { useState } from 'react';
import { ChartColumn, ChevronDown, Skull } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { groupByBoss } from '../lib/night';
import { lowestBossHp } from '../lib/verdict';
import { useNote } from '../lib/notes';
import { dungeonsOnly, raidOnly } from '../lib/content';

const DUNGEONS_OPEN_KEY = 'wipe-cause:dungeons-open';

/** `summary`: NIGHT = visão geral da noite; chave de boss = resumo daquele boss; null = um pull. */
export const NIGHT = 'night';

export interface PullListProps {
  pulls: Pull[];
  selected: number | null;
  onSelect: (id: number) => void;
  summary: string | null;
  onSummary: (key: string) => void;
}

/** Resumo da noite + pulls agrupados por boss, cada boss com o próprio resumo. */
export function PullList({ pulls, selected, onSelect, summary, onSummary }: PullListProps) {
  const raid = raidOnly(pulls);
  const dungeons = dungeonsOnly(pulls);
  const [openDungeons, setOpenDungeons] = useState(() => {
    try {
      return localStorage.getItem(DUNGEONS_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleDungeons = () => {
    const next = !openDungeons;
    setOpenDungeons(next);
    try {
      localStorage.setItem(DUNGEONS_OPEN_KEY, next ? '1' : '0');
    } catch {
      /* sem storage */
    }
  };
  const props = { selected, onSelect, summary, onSummary };
  return (
    <nav className="pull-tree" aria-label="Pulls">
      {raid.length > 0 && <SummaryLink active={summary === NIGHT} onClick={() => onSummary(NIGHT)} label="Resumo da noite" />}
      {raid.length > 0 ? <BossGroups pulls={raid} {...props} /> : <p className="muted small pull-tree-note">Nenhum boss de raid neste log.</p>}
      {dungeons.length > 0 && (
        <section className="dungeon-block">
          <button className="dungeon-toggle" onClick={toggleDungeons} aria-expanded={openDungeons}>
            <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${openDungeons ? 'open' : ''}`} aria-hidden />
            Masmorras (M+) <span className="group-count">{dungeons.length}</span>
          </button>
          {openDungeons && <BossGroups pulls={dungeons} {...props} />}
        </section>
      )}
    </nav>
  );
}

function BossGroups({ pulls, selected, onSelect, summary, onSummary }: PullListProps) {
  return (
    <>
      {groupByBoss(pulls).map(({ key, pulls: ps }) => (
        <section key={key}>
          <h3>
            {key}
            <span className="group-count">{ps.length}</span>
          </h3>
          <SummaryLink active={summary === key} onClick={() => onSummary(key)} label="Resumo do boss" />
          {ps.map((p) => {
            const hp = lowestBossHp(p);
            const deaths = p.deaths.filter((d) => !d.ignored).length;
            const active = summary == null && selected === p.id;
            return (
              <button
                key={p.id}
                className={`pull-row ${p.success ? 'kill' : 'wipe'} ${active ? 'active' : ''}`}
                onClick={() => onSelect(p.id)}
                aria-current={active ? 'page' : undefined}
                title={`Pull ${p.pullNumber} · ${p.success ? 'kill' : `boss em ${pct(hp)}`} · ${mmss(p.durationMs)} · ${deaths} mortes`}
              >
                <span className="pull-num">
                  {p.pullNumber}
                  <NoteDot pull={p} />
                </span>
                <span className="pull-result">{p.success ? 'Kill' : pct(hp)}</span>
                {/* progresso até o kill: quanto do HP do boss já foi */}
                <span className="pull-meter" aria-hidden>
                  <span style={{ transform: `scaleX(${p.success ? 1 : hp != null ? (100 - hp) / 100 : 0})` }} />
                </span>
                <span className="pull-meta">{mmss(p.durationMs)}</span>
                <span className="pull-deaths">
                  {deaths}
                  <Skull size={12} strokeWidth={1.75} aria-label="mortes" />
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}

/** Pontinho no número do pull quando há anotação (o texto aparece ao passar o mouse). */
function NoteDot({ pull }: { pull: Pull }) {
  const [note] = useNote(pull);
  if (!note.trim()) return null;
  return <span className="pull-note-dot" title={note} aria-label={`Anotação: ${note}`} />;
}

function SummaryLink({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`summary-link ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <ChartColumn size={16} strokeWidth={2} aria-hidden /> {label}
    </button>
  );
}
