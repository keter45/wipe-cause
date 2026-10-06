import { useEffect, useState } from 'react';
import { ChartColumn, ChevronDown, Skull } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { groupByBoss } from '../lib/night';
import { lowestBossHp } from '../lib/verdict';
import { useNote } from '../lib/notes';
import { dungeonsOnly, raidOnly } from '../lib/content';
import { BossName } from './Names';
import { useMessages } from '../i18n';
import { pullListMsg } from './PullList.i18n';

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

/** Resumo da noite + uma linha por boss (o resumo dele), com os pulls embaixo. */
export function PullList({ pulls, selected, onSelect, summary, onSummary }: PullListProps) {
  const t = useMessages(pullListMsg);
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
      {raid.length > 0 && <SummaryLink active={summary === NIGHT} onClick={() => onSummary(NIGHT)} label={t.nightSummary} />}
      {raid.length > 0 ? <BossGroups pulls={raid} {...props} /> : <p className="muted small pull-tree-note">{t.noRaidBoss}</p>}
      {dungeons.length > 0 && (
        <section className="dungeon-block">
          <button className="dungeon-toggle" onClick={toggleDungeons} aria-expanded={openDungeons}>
            <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${openDungeons ? 'open' : ''}`} aria-hidden />
            {t.dungeons} <span className="group-count">{dungeons.length}</span>
          </button>
          {openDungeons && <BossGroups pulls={dungeons} {...props} />}
        </section>
      )}
    </nav>
  );
}

/**
 * Uma linha por boss, em acordeão: clicar abre o resumo do boss e mostra os pulls dele,
 * recolhendo os outros. Começa aberto o boss do pull que está na tela.
 */
function BossGroups({ pulls, selected, onSelect, summary, onSummary }: PullListProps) {
  const t = useMessages(pullListMsg);
  const groups = groupByBoss(pulls);
  const current = groups.find((g) => g.pulls.some((p) => p.id === selected))?.key ?? null;
  const [open, setOpen] = useState<string | null>(current);
  // foi para um pull de outro boss (lista, atalho, ao vivo): abre o grupo dele
  useEffect(() => {
    if (current) setOpen(current);
  }, [current]);
  const toggle = (key: string) => setOpen((prev) => (prev === key ? null : key));

  return (
    <>
      {groups.map(({ key, pulls: ps }) => {
        const kills = ps.filter((p) => p.success).length;
        const best = ps.filter((p) => !p.success).reduce<number | null>((m, p) => {
          const hp = lowestBossHp(p);
          return hp != null && (m == null || hp < m) ? hp : m;
        }, null);
        const meta = t.meta(ps.length, kills > 0, best != null ? pct(best) : null);
        const isOpen = open === key;
        const active = summary === key;
        return (
          <section key={key} className="boss-group">
            <div className={`boss-row ${active ? 'active' : ''}`}>
              <button
                className="boss-row-main"
                onClick={() => {
                  setOpen(key);
                  onSummary(key);
                }} title={t.openSummary(key, meta)} aria-current={active ? 'page' : undefined}>
                <BossName encounterId={ps[0].encounterId} name={key} size={18} />
                <span className={`boss-row-meta ${kills ? 'kill' : ''}`}>{meta}</span>
              </button>
              <button
                className="icon-btn sm boss-row-toggle"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-label={t.togglePullsAria(isOpen, key)}
                title={t.togglePulls(isOpen)}
              >
                <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${isOpen ? 'open' : ''}`} aria-hidden />
              </button>
            </div>
            {isOpen &&
              ps.map((p) => {
                const hp = lowestBossHp(p);
                const deaths = p.deaths.filter((d) => !d.ignored).length;
                const activePull = summary == null && selected === p.id;
                return (
                  <button
                    key={p.id}
                    className={`pull-row ${p.success ? 'kill' : 'wipe'} ${activePull ? 'active' : ''}`}
                    onClick={() => onSelect(p.id)}
                    aria-current={activePull ? 'page' : undefined}
                    title={t.pullTitle(p.pullNumber, p.success ? null : pct(hp), mmss(p.durationMs), deaths)}
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
                      <Skull size={12} strokeWidth={1.75} aria-label={t.deaths} />
                    </span>
                  </button>
                );
              })}
          </section>
        );
      })}
    </>
  );
}

/** Pontinho no número do pull quando há anotação (o texto aparece ao passar o mouse). */
function NoteDot({ pull }: { pull: Pull }) {
  const [note] = useNote(pull);
  const t = useMessages(pullListMsg);
  if (!note.trim()) return null;
  return <span className="pull-note-dot" title={note} aria-label={t.note(note)} />;
}

function SummaryLink({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`summary-link ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <ChartColumn size={16} strokeWidth={2} aria-hidden /> {label}
    </button>
  );
}
