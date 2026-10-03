import { mmss, num } from '../../lib/format';
import { isHealer, outputPerSec, type CooldownInfo, type Sample } from '../../lib/performance';
import { advantageWindows, castDiff, losses, myDeaths, myMechanicFailures, relevantSpells, takenMoreThan, type Loss } from '../../lib/solo';
import { specLabel } from '../../lib/specs';
import { scoreTone } from '../../lib/score';
import { SpellIcon, SpellName } from '../SpellIcon';
import { BossName, PlayerName } from '../Names';
import { CooldownCompare } from '../perf/CooldownCompare';
import { Card, Section, type CardDetail } from './common';

const SUMMARY_LOSSES = 3;

const costLabel = (l: Loss, unit: string) =>
  l.lost != null ? `~${num(l.lost)} de ${unit === 'HPS' ? 'cura' : 'dano'}` : l.weightSec >= 25 ? 'custo alto' : l.weightSec >= 8 ? 'custo médio' : 'custo baixo';

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
          {mmss(p.durationMs)}){ref_ ? ` · comparado com ${refLabel}` : ''}
        </>
      }
      big={diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined}
      bigTone={diff != null && diff < -3 ? 'warn' : ''}
      foot={`${unit} por segundo vivo${full ? ' · relatório completo' : ''}`}
    >
      <div className="share-stats">
        <div>
          <span className="share-muted small">{unit === 'HPS' ? 'Cura' : 'Dano'} por segundo vivo</span>
          <strong>{num(out)}</strong>
          {ref_ && <span className="share-muted small">referência {num(refOut)}</span>}
        </div>
        <div>
          <span className="share-muted small">Rotação</span>
          <strong>{r ? <span className={`score-pill ${scoreTone(r.score)}`}>{r.score}</span> : '—'}</strong>
          {r && <span className="share-muted small">{mmss(r.downtimeMs)} parado</span>}
        </div>
        <div>
          <span className="share-muted small">Sobrevivência</span>
          <strong className={deaths.length ? 'share-bad' : ''}>{deaths.length ? `morreu ${mmss(deaths[0].death.t)}` : 'vivo até o fim'}</strong>
        </div>
        <div>
          <span className="share-muted small">Erros de mecânica</span>
          <strong>{mechs.reduce((n, m) => n + m.player.count, 0)}</strong>
        </div>
      </div>

      <Section title="Para o próximo pull" aside="os erros ordenados pelo que custaram">
        {shown.length ? (
          <ol className="share-losses">
            {shown.map((l) => (
              <li key={l.key}>
                {l.spellId != null && <SpellIcon spellId={l.spellId} size={16} />} <strong>{l.title}</strong> <span className="share-muted">· {costLabel(l, unit)}</span>
                {l.tip && <div className="share-muted small">{l.tip}</div>}
              </li>
            ))}
            {!full && ls.length > shown.length && <li className="share-more">+{ls.length - shown.length} no relatório completo</li>}
          </ol>
        ) : (
          <p className="share-muted">Nada de grave: sem morte cedo, sem erro de mecânica e a rotação sem falhas claras.</p>
        )}
      </Section>

      {full && ref_ && <SoloDetails me={me} ref_={ref_} refLabel={refLabel} unit={unit} cds={cds} sameSpec={sameSpec} />}
    </Card>
  );
}

function SoloDetails({ me, ref_, refLabel, unit, cds, sameSpec }: { me: Sample; ref_: Sample; refLabel: string; unit: string; cds: Map<number, CooldownInfo>; sameSpec: boolean }) {
  const windows = advantageWindows(me, ref_);
  const relevant = relevantSpells(me.player, ref_.player);
  const taken = takenMoreThan(me, ref_);
  return (
    <>
      {windows.length > 0 && (
        <Section title="Onde a referência abriu vantagem">
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
                    referência {num(w.ref / sec)} × você {num(w.mine / sec)} {unit}
                  </span>
                  {w.deadAt != null && <span className="share-bad"> · você morreu em {mmss(w.deadAt)}</span>}
                  {diff.length > 0 && (
                    <div className="small">
                      A referência usou mais:{' '}
                      {diff.map((d, i) => (
                        <span key={d.name}>
                          {i > 0 && ', '}
                          <SpellName spellId={d.spellId} name={d.name} size={14} /> {d.ref}× (você {d.mine}×)
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
        <Section title={`Dano que você tomou bem mais que ${refLabel}`} aside="por minuto vivo">
          <table className="share-table">
            <thead>
              <tr>
                <th>Habilidade</th>
                <th className="num">Você</th>
                <th className="num">Referência</th>
                <th className="num">% do seu dano tomado</th>
              </tr>
            </thead>
            <tbody>
              {taken.slice(0, 8).map((t) => (
                <tr key={t.name}>
                  <td>
                    <SpellName spellId={t.spellId} name={t.name} size={14} />
                  </td>
                  <td className="num">{num(t.minePerMin)}</td>
                  <td className="num">{num(t.refPerMin)}</td>
                  <td className="num">{(t.share * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
