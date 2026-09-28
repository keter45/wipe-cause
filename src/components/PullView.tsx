import { useState } from 'react';
import type { Pull } from '../types';
import { mmss, pct } from '../lib/format';
import { analyzePull } from '../lib/verdict';
import { DeathList } from './DeathList';
import { PlayersTable } from './PlayersTable';
import { EnemySpellsTable } from './EnemySpellsTable';

type Tab = 'deaths' | 'players' | 'spells';

const SEVERITY_LABEL = { wipe: 'Causa', major: 'Grave', minor: 'Atenção', info: 'Info' } as const;

export function PullView({ pull }: { pull: Pull }) {
  const [tab, setTab] = useState<Tab>('deaths');
  const verdict = analyzePull(pull);
  const decisive = new Set(verdict.decisiveDeaths.map((d) => `${d.guid}:${d.t}`));

  return (
    <div className="pull-view">
      <div className="pull-header">
        <div>
          <h2>
            {pull.encounterName} <span className="muted">· {pull.difficultyName} · pull {pull.pullNumber}</span>
          </h2>
          <div className="muted">
            {pull.startLocal.split(' ')[1]?.slice(0, 8)} · {mmss(pull.durationMs)}
            {pull.incomplete && <span className="warn"> · log terminou antes do fim do encontro</span>}
          </div>
        </div>
        <div className="boss-bars">
          {pull.bosses.map((b) => (
            <div key={b.guid} className="boss-bar" title={`${b.name}: ${pct(b.hpPct)}`}>
              <div className="boss-bar-fill" style={{ width: `${b.hpPct ?? 0}%` }} />
              <span>
                {b.name} {pct(b.hpPct)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <section className={`verdict ${pull.success ? 'kill' : 'wipe'}`}>
        <h3>{verdict.headline}</h3>
        {verdict.findings.length > 0 && (
          <ul className="findings">
            {verdict.findings.map((f, i) => (
              <li key={i} className={`finding ${f.severity}`}>
                <span className="badge">{SEVERITY_LABEL[f.severity]}</span>
                <span>
                  <strong>{f.title}</strong>
                  {f.detail && <span className="muted"> — {f.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'deaths'} className={tab === 'deaths' ? 'active' : ''} onClick={() => setTab('deaths')}>
          Mortes ({pull.deaths.length})
        </button>
        <button role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
          Jogadores ({pull.players.length})
        </button>
        <button role="tab" aria-selected={tab === 'spells'} className={tab === 'spells' ? 'active' : ''} onClick={() => setTab('spells')}>
          Habilidades do boss
        </button>
      </div>

      {tab === 'deaths' && <DeathList deaths={pull.deaths} decisive={decisive} />}
      {tab === 'players' && <PlayersTable players={pull.players} />}
      {tab === 'spells' && <EnemySpellsTable spells={pull.enemySpells} />}
    </div>
  );
}
