import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { lowestBossHp } from '../lib/verdict';

interface Props {
  pulls: Pull[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export function PullList({ pulls, selected, onSelect }: Props) {
  // agrupa por boss + dificuldade, na ordem em que apareceram
  const groups = new Map<string, Pull[]>();
  for (const p of pulls) {
    const key = `${p.encounterName} · ${p.difficultyName}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <nav className="pull-list">
      {[...groups.entries()].map(([title, ps]) => (
        <section key={title}>
          <h3>{title}</h3>
          {ps.map((p) => {
            const hp = lowestBossHp(p);
            return (
              <button
                key={p.id}
                className={`pull-row ${p.success ? 'kill' : 'wipe'} ${selected === p.id ? 'active' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="pull-num">#{p.pullNumber}</span>
                <span className="pull-result">{p.success ? 'Kill' : pct(hp)}</span>
                <span className="pull-meta muted">
                  {mmss(p.durationMs)} · {p.deaths.length}☠
                </span>
                {!p.success && hp != null && (
                  <span className="pull-hp" style={{ width: `${100 - hp}%` }} aria-hidden />
                )}
              </button>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
