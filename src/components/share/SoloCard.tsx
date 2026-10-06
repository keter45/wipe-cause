import { mmss, num } from '../../lib/format';
import { isHealer, outputPerSec, type CooldownInfo, type Sample } from '../../lib/performance';
import { advantageWindows, castDiff, losses, myDeaths, myMechanicFailures, relevantSpells, takenMoreThan, type Loss } from '../../lib/solo';
import { specLabel } from '../../lib/specs';
import { scoreTone } from '../../lib/score';
import { SpellIcon, SpellName } from '../SpellIcon';
import { BossName, PlayerName } from '../Names';
import { CooldownCompare } from '../perf/CooldownCompare';
import { Card, Section, type CardDetail } from './common';
import { messagesOf, useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

const SUMMARY_LOSSES = 3;

const costLabel = (l: Loss, unit: string) => {
  const t = messagesOf(shareMsg);
  return l.lost != null ? t.cost(num(l.lost), unit === 'HPS') : l.weightSec >= 25 ? t.costHigh : l.weightSec >= 8 ? t.costMid : t.costLow;
};

/**
 * Modo solo: o pull de um jogador, para mandar a ele (ou guardar). Resumo: os números contra a
 * referência, os 3 erros que mais custaram e as mortes/mecânicas. Completo: todos os erros, os
 * trechos em que a referência abriu vantagem, os cooldowns e o dano tomado a mais.
 */
export function SoloShareCard({
  me,
  ref_,
  refLabel,
  cds,
  detail = 'summary',
}: {
  me: Sample;
  ref_: Sample | null;
  refLabel: string;
  cds: Map<number, CooldownInfo>;
  detail?: CardDetail;
}) {
  const t = useMessages(shareMsg);
  const full = detail === 'full';
  const unit = isHealer(me.player) ? 'HPS' : 'DPS';
  const out = outputPerSec(me);
  const refOut = ref_ ? outputPerSec(ref_) : 0;
  const diff = refOut > 0 ? ((out - refOut) / refOut) * 100 : null;
  const ls = losses(me);
  const shown = full ? ls : ls.slice(0, SUMMARY_LOSSES);
  const deaths = myDeaths(me);
  const mechs = myMechanicFailures(me);
  const r = me.player.rotation;
  const sameSpec = ref_ != null && ref_.player.specId === me.player.specId;
  const p = me.pull;

  return (
    <Card
      tone={p.success ? 'kill' : 'wipe'}
      wide={full}
      title={
        <>
          <PlayerName name={me.player.name} cls={me.player.class} /> · {specLabel(me.player.specId)}
        </>
      }
      sub={
        <>
          <BossName encounterId={p.encounterId} name={`${p.encounterName} ${p.difficultyName}`} size={16} /> · pull {p.pullNumber} ({p.success ? 'kill' : 'wipe'},{' '}
          {mmss(p.durationMs)}){ref_ ? t.comparedWith(refLabel) : ''}
        </>
      }
      big={diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined}
      bigTone={diff != null && diff < -3 ? 'warn' : ''}
      foot={t.perAliveSecond(unit) + (full ? t.fullReport : '')}
    >
      <div className="share-stats">
        <div>
          <span className="share-muted small">{t.outputLabel(unit === 'HPS')}</span>
          <strong>{num(out)}</strong>
          {ref_ && <span className="share-muted small">{t.reference(num(refOut))}</span>}
        </div>
        <div>
          <span className="share-muted small">{t.rotation}</span>
          <strong>{r ? <span className={`score-pill ${scoreTone(r.score)}`}>{r.score}</span> : '—'}</strong>
          {r && <span className="share-muted small">{t.idle(mmss(r.downtimeMs))}</span>}
        </div>
        <div>
          <span className="share-muted small">{t.survival}</span>
          <strong className={deaths.length ? 'share-bad' : ''}>{deaths.length ? t.diedAt(mmss(deaths[0].death.t)) : t.aliveToEnd}</strong>
        </div>
        <div>
          <span className="share-muted small">{t.mechErrors}</span>
          <strong>{mechs.reduce((n, m) => n + m.player.count, 0)}</strong>
        </div>
      </div>

      <Section title={t.nextPull} aside={t.nextPullAside}>
        {shown.length ? (
          <ol className="share-losses">
            {shown.map((l) => (
              <li key={l.key}>
                {l.spellId != null && <SpellIcon spellId={l.spellId} size={16} />} <strong>{l.title}</strong> <span className="share-muted">· {costLabel(l, unit)}</span>
                {l.tip && <div className="share-muted small">{l.tip}</div>}
              </li>
            ))}
            {!full && ls.length > shown.length && <li className="share-more">{t.more(ls.length - shown.length)}</li>}
          </ol>
        ) : (
          <p className="share-muted">{t.nothingSerious}</p>
        )}
      </Section>

      {full && ref_ && <SoloDetails me={me} ref_={ref_} refLabel={refLabel} unit={unit} cds={cds} sameSpec={sameSpec} />}
    </Card>
  );
}

function SoloDetails({ me, ref_, refLabel, unit, cds, sameSpec }: { me: Sample; ref_: Sample; refLabel: string; unit: string; cds: Map<number, CooldownInfo>; sameSpec: boolean }) {
  const t = useMessages(shareMsg);
  const windows = advantageWindows(me, ref_);
  const relevant = relevantSpells(me.player, ref_.player);
  const taken = takenMoreThan(me, ref_);
  return (
    <>
      {windows.length > 0 && (
        <Section title={t.refAdvantage}>
          <ul>
            {windows.map((w) => {
              const sec = (w.endMs - w.startMs) / 1000;
              const diff = sameSpec ? castDiff(w, relevant) : [];
              return (
                <li key={w.startMs}>
                  <strong>
                    {mmss(w.startMs)}–{mmss(w.endMs)}
                  </strong>{' '}
                  <span className="share-muted">
                    {t.refVsYou(num(w.ref / sec), num(w.mine / sec), unit)}
                  </span>
                  {w.deadAt != null && <span className="share-bad">{t.youDiedAt(mmss(w.deadAt))}</span>}
                  {diff.length > 0 && (
                    <div className="small">
                      {t.refUsedMore}{' '}
                      {diff.map((d, i) => (
                        <span key={d.name}>
                          {i > 0 && ', '}
                          <SpellName spellId={d.spellId} name={d.name} size={14} /> {d.ref}×{t.youCast(d.mine)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {sameSpec && <CooldownCompare me={me} ref_={ref_} cds={cds} refName={refLabel} expanded />}
      {taken.length > 0 && (
        <Section title={t.takenMore(refLabel)} aside={t.perAliveMinute}>
          <table className="share-table">
            <thead>
              <tr>
                <th>{t.ability}</th>
                <th className="num">{t.you}</th>
                <th className="num">{t.referenceCol}</th>
                <th className="num">{t.shareOfTaken}</th>
              </tr>
            </thead>
            <tbody>
              {taken.slice(0, 8).map((row) => (
                <tr key={row.name}>
                  <td>
                    <SpellName spellId={row.spellId} name={row.name} size={14} />
                  </td>
                  <td className="num">{num(row.minePerMin)}</td>
                  <td className="num">{num(row.refPerMin)}</td>
                  <td className="num">{(row.share * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
