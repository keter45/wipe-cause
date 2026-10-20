import { startTransition, useEffect, useState, type ReactNode } from 'react';
import { ChartColumn, ChevronDown, Skull } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { groupByBoss } from '../lib/night';
import { lowestBossHp, wipeCause } from '../lib/verdict';
import { mechanicSpellId } from '../lib/spells';
import { SpellIcon } from './SpellIcon';
import { useNote } from '../lib/notes';
import { dungeonsOnly, raidOnly } from '../lib/content';
import { BossName } from './Names';
import { useMessages } from '../i18n';
import { pullListMsg } from './PullList.i18n';
import { bestWipe, progressLabel, reachedPhase } from '../lib/phases';

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
/** Vida na fase como o Warcraft Logs: inteira de 10% para cima ("69%"), uma casa abaixo ("3.9%"). */
const phasePct = (hp: number | null) => (hp == null ? '—' : hp >= 10 ? `${Math.floor(hp)}%` : pct(hp));

export function PullList({ pulls, selected: selectedProp, onSelect: select, summary: summaryProp, onSummary: openSummary }: PullListProps) {
  const t = useMessages(pullListMsg);
  // a lista responde ao clique na hora; a tela principal (a análise inteira do pull) vem depois, em transição
  const [pending, setPending] = useState<{ selected: number | null; summary: string | null } | null>(null);
  useEffect(() => setPending(null), [selectedProp, summaryProp]);
  const selected = pending ? pending.selected : selectedProp;
  const summary = pending ? pending.summary : summaryProp;
  const onSelect = (id: number) => {
    setPending({ selected: id, summary: null });
    startTransition(() => select(id));
  };
  const onSummary = (key: string) => {
    setPending({ selected: selectedProp, summary: key });
    startTransition(() => openSummary(key));
  };
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
          <Fold open={openDungeons}>
            <BossGroups pulls={dungeons} {...props} />
          </Fold>
        </section>
      )}
    </nav>
  );
}

/**
 * Uma linha por boss: clicar abre ou fecha os pulls dele, sem fechar os outros nem sair da tela atual.
 * O resumo do boss é a primeira linha dentro. Começa aberto o boss do pull que está na tela.
 */
function BossGroups({ pulls, selected, onSelect, summary, onSummary }: PullListProps) {
  const t = useMessages(pullListMsg);
  const groups = groupByBoss(pulls);
  const current = groups.find((g) => g.pulls.some((p) => p.id === selected))?.key ?? null;
  // cada boss abre e fecha sozinho (abrir um não fecha os outros); começa aberto o do pull na tela, ou o único
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current] : groups.length === 1 ? [groups[0].key] : []));
  // foi para um pull de outro boss (lista, atalho, ao vivo): abre o grupo dele também
  useEffect(() => {
    if (current) setOpen((s) => (s.has(current) ? s : new Set(s).add(current)));
  }, [current]);
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      {groups.map(({ key, pulls: ps }) => {
        const kills = ps.filter((p) => p.success).length;
        const top = bestWipe(ps);
        const meta = t.meta(ps.length, kills > 0, top ? progressLabel(top) : null);
        const isOpen = open.has(key);
        // o boss do que está na tela (o resumo dele ou um pull dele)
        const here = summary === key || (summary == null && ps.some((p) => p.id === selected));
        return (
          <section key={key} className="boss-group">
            {/* a linha inteira abre e fecha os pulls; o resumo do boss é a primeira linha dentro */}
            <button className={`boss-row ${here ? 'active' : ''}`} onClick={() => toggle(key)} aria-expanded={isOpen} aria-label={t.togglePullsAria(isOpen, key)}>
              <span className="boss-row-main">
                <BossName encounterId={ps[0].encounterId} name={key} size={18} />
                <span className={`boss-row-meta ${kills ? 'kill' : ''}`}>{meta}</span>
              </span>
              <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${isOpen ? 'open' : ''}`} aria-hidden />
            </button>
            <Fold open={isOpen}>
              <button className={`boss-summary-link ${summary === key ? 'active' : ''}`} onClick={() => onSummary(key)} aria-current={summary === key ? 'page' : undefined} title={t.openSummary(key, meta)}>
                {t.bossSummary}
              </button>
              {ps.map((p) => {
                const hp = lowestBossHp(p);
                // boss de várias fases: até onde o try chegou (o HP é do boss da primeira fase)
                const phase = p.success ? null : reachedPhase(p);
                const deaths = p.deaths.filter((d) => !d.ignored).length;
                // o que puxou o wipe (o gatilho que explica as mortes); sem causa comum, a caveira com o número
                const cause = wipeCause(p);
                const causeSpell = cause ? mechanicSpellId(p, cause.key) : null;
                const activePull = summary == null && selected === p.id;
                return (
                  <button
                    key={p.id}
                    className={`pull-row ${p.success ? 'kill' : 'wipe'} ${activePull ? 'active' : ''}`}
                    onClick={() => onSelect(p.id)}
                    aria-current={activePull ? 'page' : undefined}
                    title={t.pullTitle(p.pullNumber, p.success ? null : pct(hp), mmss(p.durationMs), deaths) + (phase ? t.reached(phase.name) : '') + (cause ? t.cause(cause.name, cause.deaths) : '')}
                  >
                    <span className="pull-num">
                      {p.pullNumber}
                      <NoteDot pull={p} />
                    </span>
                    <span className={`pull-result ${phase ? `phase ph-${Math.min(phase.index, 3)}` : ''}`}>
                      {p.success ? (
                        'Kill'
                      ) : phase ? (
                        <>
                          <span className="pull-phase">{phase.short}</span>
                          {phasePct(hp)}
                        </>
                      ) : (
                        pct(hp)
                      )}
                    </span>
                    {/* progresso na fase em que o pull acabou: quanto da vida dos bosses dela já foi (como o Warcraft Logs) */}
                    <span className={`pull-meter ${phase ? `phase ph-${Math.min(phase.index, 3)}` : ''}`} aria-hidden>
                      <span style={{ transform: `scaleX(${p.success ? 1 : hp != null ? (100 - hp) / 100 : 0})` }} />
                    </span>
                    <span className="pull-meta">{mmss(p.durationMs)}</span>
                    <span className="pull-deaths">
                      {cause && causeSpell != null ? (
                        <SpellIcon spellId={causeSpell} size={16} title={t.causeIcon(cause.name, cause.deaths)} hover={false} />
                      ) : (
                        <>
                          {deaths}
                          <Skull size={12} strokeWidth={1.75} aria-label={t.deaths} />
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </Fold>
          </section>
        );
      })}
    </>
  );
}

/** Abre e fecha com a altura animada (linhas da grade de 0fr a 1fr); fechado, sai do DOM no fim da animação. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <div
      className={`fold ${open ? 'open' : ''}`}
      inert={!open}
      onTransitionEnd={(e) => {
        if (!open && e.target === e.currentTarget) setMounted(false);
      }}
    >
      <div>{mounted && children}</div>
    </div>
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
