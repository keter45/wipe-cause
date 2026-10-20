import type { DecisionFinding } from '../lib/decisions';
import { mmss, uniqueSeconds } from '../lib/format';
import { useSeek } from '../lib/wcr';
import { useMessages } from '../i18n';
import { SpellIcon } from './SpellIcon';
import { Colored, useMentionsSpell } from './Names';
import { PlayAt } from './VideoPanel';
import { decisionMsg } from './DecisionList.i18n';

const pct = (x: number) => Math.round(x * 100);
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/**
 * Decisões diferentes da referência (proc perdido ou esperando, cooldown segurado ou fora do
 * alinhamento), com os momentos. `who`: nome da referência quando é um log só; sem ele, os tops.
 */
export function DecisionList({ list, who = null, notes }: { list: DecisionFinding[]; who?: string | null; notes?: Record<string, string> }) {
  const t = useMessages(decisionMsg);
  const mentions = useMentionsSpell();
  const seek = useSeek();
  const text = (d: DecisionFinding): string => {
    switch (d.kind) {
      case 'proc_lost':
        return t.procLost(d.name, pct(d.you), pct(d.tops), who);
      case 'proc_wait':
        return t.procWait(d.name, d.you.toFixed(1), d.tops.toFixed(1), d.instead.name, who);
      case 'cd_held':
        return t.cdHeld(d.name, secs(d.you), secs(d.tops), who);
      case 'cd_align':
        return (d.partnerKind === 'cast' ? t.cdAlignCast : t.cdAlignBuff)(d.name, d.partnerName, pct(d.tops), pct(d.you), who);
    }
  };
  return (
    <ul className="plain bench-list small">
      {list.map((d) => {
        const times = uniqueSeconds(d.times);
        const key = `${d.kind}-${'buff' in d ? d.buff : d.spellId}`;
        return (
          <li key={key}>
            {!mentions(text(d)) && <SpellIcon spellId={'buff' in d ? d.buff : d.spellId} size={16} />}{' '}
            <span className="warn">
              <Colored text={text(d)} />
            </span>
            {'consumers' in d && (
              <span className="muted">
                {' '}
                <Colored text={t.spentBy(d.consumers.map((c) => c.name).join(', '))} />
              </span>
            )}
            {times.length > 0 && (
              <span className="rot-times">
                {times.slice(0, 6).map((at) => (
                  <span key={at} className="rot-time">
                    {mmss(at)}
                    <PlayAt t={at} seek={seek} />
                  </span>
                ))}
                {times.length > 6 && <span className="muted"> +{times.length - 6}</span>}
              </span>
            )}
            {notes?.[key] && (
              <span className="decision-note">
                <Colored text={notes[key]} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
