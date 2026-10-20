import type { PlayerStats } from '../../types';
import { classColor, shortName } from '../../lib/format';
import { specLabel } from '../../lib/specs';
import { useMessages } from '../../i18n';
import { perfViewMsg } from './perf.i18n';

const ROLES = ['tank', 'healer', 'dps'] as const;
const classIcon = (cls: string | null | undefined) => (cls ? `https://wow.zamimg.com/images/wow/icons/medium/classicon_${cls.toLowerCase()}.jpg` : null);

/**
 * Quem ver no Desempenho: o pull inteiro em cartões por papel (tanks, healers, DPS), com classe, spec e item
 * level, em vez de uma lista longa. O escolhido fica marcado na cor da classe.
 */
export function PlayerPicker({ players, value, onPick }: { players: PlayerStats[]; value: string; onPick: (p: PlayerStats) => void }) {
  const t = useMessages(perfViewMsg);
  const label = { tank: t.roleTanks, healer: t.roleHealers, dps: t.roleDps };
  return (
    <div className="player-picker" role="radiogroup" aria-label={t.player}>
      {ROLES.map((role) => {
        const group = players.filter((p) => (p.role ?? 'dps') === role);
        if (!group.length) return null;
        return (
          <div key={role} className="player-picker-group">
            <span className="player-picker-role muted small">{label[role]}</span>
            <div className="player-picker-cards">
              {group.map((p) => {
                const on = p.guid === value;
                const icon = classIcon(p.class);
                const ilvl = p.setup?.itemLevel ? Math.round(p.setup.itemLevel) : null;
                return (
                  <button
                    key={p.guid}
                    role="radio"
                    aria-checked={on}
                    className={`player-card ${on ? 'active' : ''}`}
                    style={{ ['--class' as string]: classColor(p.class) }}
                    onClick={() => onPick(p)}
                  >
                    {icon ? <img src={icon} alt="" width={28} height={28} loading="lazy" /> : <span className="player-card-blank" aria-hidden />}
                    <span className="player-card-name">{shortName(p.name)}</span>
                    <span className="player-card-spec">
                      {specLabel(p.specId)}
                      {ilvl != null && <span className="tabular"> · {ilvl}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
