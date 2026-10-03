import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { RotationFinding, RotationResult } from '../types';
import { mmss } from '../lib/format';
import { openExternal } from '../lib/api';
import { useSeek } from '../lib/wcr';
import { scoreTone } from '../lib/score';
import { SpellIcon, SpellName } from './SpellIcon';
import { PlayAt } from './VideoPanel';

const KIND: Record<RotationFinding['importance'], string> = { high: 'Erro', medium: 'Ajuste', low: 'Detalhe' };

/**
 * A rotação do player comparada com a rotação base escrita da spec: aproveitamento, os erros
 * (com o momento, para ver no vídeo), a abertura, o uso dos cooldowns e a prioridade da spec.
 */
export function RotationPanel({ rotation: r }: { rotation: RotationResult }) {
  const seek = useSeek();
  const [aoe, setAoe] = useState(false);
  const problems = r.findings.filter((f) => f.count > 0 && f.id !== 'cooldowns');
  const fine = r.findings.filter((f) => f.count === 0 && f.id !== 'cooldowns');
  const prio = aoe && r.priorityAoe.length ? r.priorityAoe : r.prioritySt;

  return (
    <section className="rotation">
      <header className="rotation-head">
        <div>
          <h3>Rotação</h3>
          <p className="muted small">
            Comparada com a rotação base de {r.specName}
            {r.tree ? ` (${r.tree})` : ''}, patch {r.patch}.
          </p>
        </div>
        <span className={`score-pill big ${scoreTone(r.score)}`} title="Aproveitamento: média das checagens, pesadas pela importância">
          {r.score}
        </span>
      </header>

      <div className="rotation-cols">
        <div>
          <h4>O que corrigir</h4>
          {problems.length === 0 ? (
            <p className="muted small">Nenhum erro claro nesta luta.</p>
          ) : (
            <ul className="plain rotation-findings">
              {problems.map((f) => (
                <li key={f.id} className={`rot-finding imp-${f.importance}`}>
                  <div className="rot-finding-head">
                    <span className={`rot-kind imp-${f.importance}`}>{KIND[f.importance]}</span>
                    {f.spellId != null && <SpellIcon spellId={f.spellId} size={18} />}
                    <strong>{f.title}</strong>
                  </div>
                  <p className="small">{f.detail}</p>
                  <p className="muted small">{f.tip}</p>
                  <div className="rot-rate" aria-label={`aproveitamento ${Math.round(f.rate * 100)}%`}>
                    <span style={{ transform: `scaleX(${f.rate})` }} />
                  </div>
                  {f.times.length > 0 && (
                    <p className="rot-times small">
                      {[...f.times].sort((a, b) => a - b).slice(0, 8).map((t) => (
                        <span key={t} className="rot-time">
                          {mmss(t)}
                          <PlayAt t={t} seek={seek} />
                        </span>
                      ))}
                      {f.times.length > 8 && <span className="muted"> +{f.times.length - 8}</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {fine.length > 0 && (
            <p className="muted small rot-fine">
              Sem erro: {fine.map((f) => f.title).join(' · ')}
            </p>
          )}

          {r.opener && (
            <>
              <h4>Abertura</h4>
              <p className={`small ${r.opener.ok ? 'ok-text' : ''}`}>
                {r.opener.ok
                  ? 'Na ordem certa.'
                  : `Fora da ordem ou faltando: ${r.opener.missing.map((m) => m.name).join(', ')}.`}
              </p>
              <div className="rot-seq">
                <span className="muted small">Esperado</span>
                {r.opener.expected.map((s, i) => (
                  <SpellIcon key={i} spellId={s.spellId} size={22} />
                ))}
              </div>
              <div className="rot-seq">
                <span className="muted small">Você</span>
                {r.opener.actual.map((s, i) => (
                  <SpellIcon key={i} spellId={s.spellId} size={22} />
                ))}
              </div>
            </>
          )}

          {r.cooldowns.length > 0 && (
            <>
              <h4>Cooldowns</h4>
              <table className="rot-cds small">
                <tbody>
                  {r.cooldowns.map((c) => (
                    <tr key={c.spellId}>
                      <td>
                        <SpellName spellId={c.spellId} name={c.name} size={16} />
                      </td>
                      <td className="num tabular">
                        {c.casts}/{c.possible}
                      </td>
                      <td className="rot-cd-bar">
                        <div className="rot-rate">
                          <span style={{ transform: `scaleX(${c.usage})` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Usos possíveis pelo cooldown no tempo vivo.</p>
            </>
          )}
        </div>

        <aside>
          <h4>Pontos principais da spec</h4>
          <ol className="rot-points small">
            {r.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ol>
          <h4 className="rot-prio-head">
            Prioridade
            {r.priorityAoe.length > 0 && (
              <span className="segmented sm" role="radiogroup" aria-label="Alvos">
                <button role="radio" aria-checked={!aoe} className={!aoe ? 'active' : ''} onClick={() => setAoe(false)}>
                  Alvo único
                </button>
                <button role="radio" aria-checked={aoe} className={aoe ? 'active' : ''} onClick={() => setAoe(true)}>
                  AoE
                </button>
              </span>
            )}
          </h4>
          <ol className="rot-prio small">
            {prio.map((p, i) => (
              <li key={i}>
                <SpellName spellId={p.spellId} name={p.name} size={16} />
                {p.note && <span className="muted"> — {p.note}</span>}
              </li>
            ))}
          </ol>
          <p className="muted small rot-sources">
            <BookOpen size={12} strokeWidth={1.5} aria-hidden /> Fontes:{' '}
            {r.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ' · '}
                <button className="link" onClick={() => openExternal(s.url)}>
                  {s.title} <ExternalLink size={11} strokeWidth={1.5} aria-hidden />
                </button>
              </span>
            ))}
          </p>
        </aside>
      </div>
    </section>
  );
}
