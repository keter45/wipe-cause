import { ChartColumn, Skull } from 'lucide-react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { lowestBossHp } from '../lib/verdict';

export interface PullListProps {
  pulls: Pull[];
  selected: number | null;
  onSelect: (id: number) => void;
  summaryActive: boolean;
  onSummary: () => void;
}

/** Resumo da noite + pulls agrupados por boss (dentro da análise aberta na barra lateral). */
export function PullList({ pulls, selected, onSelect, summaryActive, onSummary }: PullListProps) {
  // agrupa por boss + dificuldade, na ordem em que apareceram
  const groups = new Map<string, Pull[]>();
  for (const p of pulls) {
    const key = `${p.encounterName} · ${p.difficultyName}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <nav className="pull-tree" aria-label="Pulls">
      <button className={`summary-link ${summaryActive ? 'active' : ''}`} onClick={onSummary} aria-current={summaryActive ? 'page' : undefined}>
        <ChartColumn size={16} strokeWidth={2} aria-hidden /> Resumo da noite
      </button>
      {[...groups.entries()].map(([title, ps]) => (
        <section key={title}>
          <h3>
            {title}
            <span className="group-count">{ps.length}</span>
          </h3>
          {ps.map((p) => {
            const hp = lowestBossHp(p);
            const deaths = p.deaths.filter((d) => !d.ignored).length;
            const active = !summaryActive && selected === p.id;
            return (
              <button
                key={p.id}
                className={`pull-row ${p.success ? 'kill' : 'wipe'} ${active ? 'active' : ''}`}
                onClick={() => onSelect(p.id)}
                aria-current={active ? 'page' : undefined}
                title={`Pull ${p.pullNumber} · ${p.success ? 'kill' : `boss em ${pct(hp)}`} · ${mmss(p.durationMs)} · ${deaths} mortes`}
              >
                <span className="pull-num">{p.pullNumber}</span>
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
    </nav>
  );
}
