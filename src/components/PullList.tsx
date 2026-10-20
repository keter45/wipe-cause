import { startTransition, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Skull } from 'lucide-react';
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
    <nav className="night-nav" aria-label={t.pullsAria}>
      {raid.length > 0 && (
        <button className={`tree-sum ${summary === NIGHT ? 'active' : ''}`} onClick={() => onSummary(NIGHT)} aria-current={summary === NIGHT ? 'page' : undefined}>
          {t.nightSummary}
        </button>
      )}
      {raid.length > 0 ? <BossGroups pulls={raid} {...props} /> : <p className="muted small pull-tree-note">{t.noRaidBoss}</p>}
      {dungeons.length > 0 && (
        <section className="tree-boss">
          <button className="tree-boss-head" onClick={toggleDungeons} aria-expanded={openDungeons}>
            <span className="tree-boss-name">
              {t.dungeons} <span className="tree-count">{dungeons.length}</span>
            </span>
            <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${openDungeons ? 'open' : ''}`} aria-hidden />
          </button>
          <Fold open={openDungeons}>
            <div className="tree-dungeons">
              <BossGroups pulls={dungeons} {...props} />
            </div>
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
          <section key={key} className="tree-boss">
            {/* a linha inteira abre e fecha os pulls; o resumo do boss é a primeira linha dentro */}
            <button className={`tree-boss-head ${here ? 'active' : ''}`} onClick={() => toggle(key)} aria-expanded={isOpen} aria-label={t.togglePullsAria(isOpen, key)}>
              <span className="tree-boss-name">
                <BossName encounterId={ps[0].encounterId} name={ps[0].encounterName} size={20} />
              </span>
              {/* a dificuldade vai para a linha de baixo: o nome do boss cabe inteiro na barra */}
              <small className={`tree-boss-meta ${kills ? 'kill' : ''}`}>{ps[0].difficultyName ? `${ps[0].difficultyName} · ${meta}` : meta}</small>
              <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${isOpen ? 'open' : ''}`} aria-hidden />
            </button>
            <Fold open={isOpen}>
              <ol className="tree-pulls">
                <li>
                  <button className={`tree-sum sm ${summary === key ? 'active' : ''}`} onClick={() => onSummary(key)} aria-current={summary === key ? 'page' : undefined} title={t.openSummary(key, meta)}>
                    {t.bossSummary}
                  </button>
                </li>
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
                    <li key={p.id}>
                      <button
                        className={`tree-pull ${p.success ? 'kill' : 'wipe'} ${activePull ? 'active' : ''}`}
                        onClick={() => onSelect(p.id)}
                        aria-current={activePull ? 'page' : undefined}
                        title={t.pullTitle(p.pullNumber, p.success ? null : pct(hp), mmss(p.durationMs), deaths) + (phase ? t.reached(phase.name) : '') + (cause ? t.cause(cause.name, cause.deaths) : '')}
                      >
                        <span className="tp-n">
                          {p.pullNumber}
                          <NoteDot pull={p} />
                        </span>
                        {/* progresso na fase em que o pull acabou: quanto da vida dos bosses dela já foi (como o Warcraft Logs) */}
                        <span className="tp-bar" aria-hidden>
                          <i style={{ transform: `scaleX(${p.success ? 1 : hp != null ? (100 - hp) / 100 : 0})` }} />
                        </span>
                        <span className="tp-pct">
                          {p.success ? (
                            'Kill'
                          ) : phase ? (
                            <>
                              <small>{phase.short}</small> {phasePct(hp)}
                            </>
                          ) : (
                            phasePct(hp)
                          )}
                        </span>
                        <span className="tp-dur">{mmss(p.durationMs)}</span>
                        <span className="tp-cause">
                          {cause && causeSpell != null ? (
                            <SpellIcon spellId={causeSpell} size={16} title={t.causeIcon(cause.name, cause.deaths)} hover={false} />
                          ) : (
                            <>
                              {deaths}
                              <Skull size={11} strokeWidth={1.75} aria-label={t.deaths} />
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
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
