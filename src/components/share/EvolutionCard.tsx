import type { Trends } from '../../lib/trends';
import { Card, type CardDetail } from './common';
import { useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';
import { PlayersPanel, ProgAwardsPanel, TrendInsights, TrendMetricsStill, TrendProgress, TrendTriggers } from '../TrendsPanels';

/** Quantas mecânicas o resumo mostra no mapa de calor (o completo, as 10 da tela). */
const SUMMARY_TRIGGERS = 5;

/**
 * A Evolução de um boss, com os mesmos painéis da tela. Resumo: o que mudou, o progresso por
 * noite, as maiores causas de wipe e as métricas do grupo. Completo: + os destaques da prog e a
 * tabela dos jogadores.
 */
export function EvolutionShareCard({ tr, boss, detail = 'summary' }: { tr: Trends; boss: string; detail?: CardDetail }) {
  const t = useMessages(shareMsg);
  const full = detail === 'full';
  const pulls = tr.nights.reduce((n, x) => n + x.summary.pulls.length, 0);
  const killed = tr.nights.some((n) => n.summary.kills > 0);
  const last = tr.nights[tr.nights.length - 1]?.summary;
  const best = killed ? 'Kill' : (last?.best?.label ?? null);
  return (
    <Card
      tone={killed ? 'kill' : 'neutral'}
      wide={full}
      className="evolution-card"
      title={t.evolutionTitle(boss)}
      sub={t.evolutionSub(tr.nights.length, pulls, tr.nights[0]?.label ?? '', tr.nights[tr.nights.length - 1]?.label ?? '')}
      big={best}
      bigTone={killed ? 'share-kill' : undefined}
      foot={full ? t.fullReport.replace(/^ · /, '') : undefined}
    >
      <TrendInsights tr={tr} />
      <TrendProgress tr={tr} />
      <TrendTriggers tr={tr} limit={full ? 10 : SUMMARY_TRIGGERS} />
      <TrendMetricsStill tr={tr} full={full} />
      {full && <ProgAwardsPanel awards={tr.progAwards} deathTable={tr.deathTable} progression={tr.progression} />}
      {full && <PlayersPanel tr={tr} still />}
    </Card>
  );
}
