import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { historyTrends } from '../lib/api';
import { classColor, pct, shortName } from '../lib/format';
import { buildTrends, trendBosses, type NightInput, type Trends } from '../lib/trends';
import { scoreTone } from '../lib/score';

/**
 * Evolução entre noites de um boss: progresso, causas de wipe por noite e o que se repete com
 * cada player. Usa todas as análises salvas no histórico.
 */
export function TrendsView() {
  const [nights, setNights] = useState<NightInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<string | null>(null);

  useEffect(() => {
    historyTrends()
      .then((xs) => setNights(xs.map((x) => ({ id: x.id, title: x.title, raidStartMs: x.raidStartMs, pulls: x.report.pulls }))))
      .catch((e) => setError(String(e)));
  }, []);

  const bosses = useMemo(() => (nights ? trendBosses(nights) : []), [nights]);
  const selected = boss ?? bosses.find((b) => b.nights >= 2)?.key ?? bosses[0]?.key ?? null;
  const trends = useMemo(() => (nights && selected ? buildTrends(nights, selected) : null), [nights, selected]);

  return (
    <div className="night trends">
      <header className="night-head">
        <h2>Evolução</h2>
        <span className="muted small">Compara as noites salvas no histórico</span>
      </header>

      {error && <div className="error">Erro: {error}</div>}
      {!nights && !error && <p className="muted">Lendo o histórico…</p>}
      {nights && bosses.length === 0 && <p className="muted">Nenhuma análise salva ainda. Analise algumas noites de raid para ver a evolução.</p>}

      {bosses.length > 0 && (
        <div className="chips" role="tablist" aria-label="Boss">
          {bosses.map((b) => (
            <button key={b.key} role="tab" aria-selected={b.key === selected} className={b.key === selected ? 'active' : ''} onClick={() => setBoss(b.key)}>
              {b.key} <span className="muted">· {b.nights} noite{b.nights > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
      )}

      {trends && trends.nights.length < 2 && (
        <p className="muted">Só há uma noite de {selected} no histórico. Com duas ou mais, esta tela mostra o que melhorou e o que se repete.</p>
      )}
      {trends && trends.nights.length >= 1 && <TrendsBody t={trends} />}
    </div>
  );
}

function TrendsBody({ t }: { t: Trends }) {
  return (
    <>
      {t.insights.length > 0 && (
        <section className="panel">
          <h3>
            <TrendingUp size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> O que mudou
          </h3>
          <ul className="insights">
            {t.insights.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3>Progresso por noite</h3>
        <div className="night-cols">
          {t.nights.map((n) => {
            const s = n.summary;
            const hp = s.kills ? 0 : s.best?.hp ?? 100;
            return (
              <div key={n.id} className="night-col" title={`${n.label}: ${s.pulls.length} pulls, ${s.kills ? 'kill' : `melhor ${pct(hp)}`}`}>
                <span className="night-col-value">{s.kills ? 'Kill' : pct(hp)}</span>
                <span className="night-col-track" aria-hidden>
                  <span className={s.kills ? 'kill' : ''} style={{ transform: `scaleY(${(100 - hp) / 100})` }} />
                </span>
                <strong>{n.label}</strong>
                <span className="muted small">{s.pulls.length} pulls</span>
              </div>
            );
          })}
        </div>
        <p className="muted small">Barra = quanto do boss já foi no melhor pull da noite.</p>
      </section>

      <section className="panel">
        <h3>Gatilho dos wipes por noite</h3>
        {t.causes.length === 0 ? (
          <p className="muted small">Sem gatilhos apontados (o boss tem regras?).</p>
        ) : (
          <div className="table-scroll">
            <table className="heat">
              <thead>
                <tr>
                  <th>Mecânica</th>
                  {t.nights.map((n) => (
                    <th key={n.id} className="num">
                      {n.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.causes.slice(0, 10).map((c) => (
                  <tr key={c.key}>
                    <td>{c.name}</td>
                    {c.perNight.map((v, i) => {
                      const wipes = t.nights[i].summary.wipes;
                      const share = v != null && wipes ? v / wipes : 0;
                      return (
                        <td key={i} className="num heat-cell" style={{ ['--heat' as string]: share }} title={`${v ?? 0} de ${wipes} wipes`}>
                          {v ? `${Math.round(share * 100)}%` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">% dos wipes da noite em que a mecânica foi o gatilho.</p>
      </section>

      <section className="panel">
        <h3>Jogadores</h3>
        <div className="table-scroll">
          <table className="players">
            <thead>
              <tr>
                <th>Jogador</th>
                <th title="Mortes por pull em cada noite (antes do corte)">Mortes por pull</th>
                <th title="Nota média de cada noite (0-100)">Nota por noite</th>
                <th className="num">Total</th>
                <th>Mais morre para</th>
                <th className="num" title="Mortes com defensivo disponível e nenhum usado">Sem def.</th>
                <th className="num">Erros mec.</th>
              </tr>
            </thead>
            <tbody>
              {t.players.map((p) => (
                <tr key={p.guid}>
                  <td style={{ color: classColor(p.class) }}>{shortName(p.name)}</td>
                  <td>
                    <Spark values={p.deathsPerPull} labels={t.nights.map((n) => n.label)} />
                  </td>
                  <td className="score-trail">
                    {p.scorePerNight.map((s, i) => (
                      <span key={i} className={s == null ? 'muted' : `score-pill ${scoreTone(s)}`} title={t.nights[i].label}>
                        {s ?? '—'}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    {p.deaths}/{p.pulls}
                  </td>
                  <td>{p.topKiller ? `${p.topKiller[0]} ${p.topKiller[1]}×` : <span className="muted">—</span>}</td>
                  <td className="num">{p.deathsNoDefensive || ''}</td>
                  <td className="num">{p.mechanicErrors || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Barrinhas de mortes por pull, uma por noite (vazio = não jogou). */
function Spark({ values, labels }: { values: (number | null)[]; labels: string[] }) {
  const W = 10;
  const H = 22;
  const max = 1; // 1 morte por pull = barra cheia
  return (
    <svg className="spark" width={values.length * (W + 3)} height={H} role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v == null ? 'não jogou' : v.toFixed(2)}`).join(', ')}>
      {values.map((v, i) => {
        const h = v == null ? 2 : Math.max(2, Math.min(1, v / max) * H);
        return (
          <rect key={i} x={i * (W + 3)} y={H - h} width={W} height={h} rx={2} className={v == null ? 'spark-none' : 'spark-bar'}>
            <title>{`${labels[i]}: ${v == null ? 'não jogou' : `${v.toFixed(2)} mortes por pull`}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
