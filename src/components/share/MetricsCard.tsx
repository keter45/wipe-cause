import type { Pull } from '../../types';
import { raidOnly } from '../../lib/content';
import { nightBossMetrics } from '../../lib/bossMetrics';
import { BossName } from '../Names';
import { MetricCard } from '../BossMetrics';
import { Card, dateOf } from './common';
import { useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

/**
 * As Métricas do grupo da noite, completas: os mesmos cartões do resumo de cada boss (barras pull a
 * pull, todos que erraram e que ajudaram, a dica), sem os botões. Vai ao Discord numa mensagem à
 * parte do resumo da noite.
 */
export function MetricsShareCard({ pulls: all }: { pulls: Pull[] }) {
  const t = useMessages(shareMsg);
  const pulls = raidOnly(all);
  const bosses = nightBossMetrics(pulls);
  const first = pulls[0];
  return (
    <Card tone="neutral" className="metrics-card" title={t.groupMetrics} sub={t.metricsSub(first ? dateOf(first) : '', pulls.length)}>
      {bosses.map((b) => (
        <section key={b.key} className="share-metrics-boss">
          {bosses.length > 1 && (
            <h4>
              <BossName encounterId={b.encounterId} name={b.key} size={18} />
            </h4>
          )}
          <div className="metric-grid">
            {b.metrics.map((m) => (
              <MetricCard key={m.key} m={m} />
            ))}
          </div>
        </section>
      ))}
    </Card>
  );
}
