import { mmss, num } from '../../lib/format';
import { burstWindows, detectCooldowns, isHealer, outputPerSec, perfInsights, totalCpm, type Sample } from '../../lib/performance';
import { BossName, PlayerName } from '../Names';
import { specLabel } from '../../lib/specs';
import { SpellIcon, SpellName } from '../SpellIcon';
import type { PerfLink } from '../WclTops';
import { CooldownCompare } from '../perf/CooldownCompare';
import { Brand, type CardDetail } from './common';

import { Stat, BurstCompare, burstKey, loadBurstPick, Rotation, Potions, SetupView } from '../perf/sections';

const SUMMARY_INSIGHTS = 5;

/**
 * Desempenho de um jogador contra a referência, para mandar a quem não tem o app (PNG, HTML ou
 * PDF). Resumo: os números, os pontos principais e os cooldowns principais. Completo: tudo o que
 * a aba mostra, aberto, com os links do fight (clicáveis no PDF e no HTML).
 */
export function PerfShareCard({
  me,
  ref_,
  refName,
  cds,
  links = [],
  detail = 'full',
}: {
  me: Sample;
  ref_: Sample;
  refName: string;
  cds: ReturnType<typeof detectCooldowns>;
  links?: PerfLink[];
  detail?: CardDetail;
}) {
  const full = detail === 'full';
  const healer = isHealer(me.player);
  const [mo, ro] = [outputPerSec(me), outputPerSec(ref_)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const allInsights = perfInsights(me, ref_, cds);
  const insights = full ? allInsights : allInsights.slice(0, SUMMARY_INSIGHTS);
  const windows = full ? burstWindows(me, ref_, cds, loadBurstPick(me.player.specId) ?? undefined) : [];
  return (
    <div className={`share-card perf-card ${full ? '' : 'perf-card-summary'}`}>
      <header className="share-head">
        <div>
          <div className="share-title">
            <PlayerName name={me.player.name} cls={me.player.class} /> · {specLabel(me.player.specId)}
          </div>
          <div className="share-sub">
            <BossName encounterId={me.pull.encounterId} name={`${me.pull.encounterName} ${me.pull.difficultyName}`} size={16} /> · pull {me.pull.pullNumber} (
            {me.pull.success ? 'kill' : 'wipe'}, {mmss(me.pull.durationMs)}) ·
            comparado com {refName}
          </div>
        </div>
        <div className={`share-big ${diff < -3 ? 'warn' : ''}`}>{ro > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : ''}</div>
      </header>

      <div className="death-stats perf-stats">
        <Stat label={`${healer ? 'Cura' : 'Dano'} por segundo vivo`} mine={num(mo)} ref={num(ro)} />
        <Stat label="Tempo vivo" mine={mmss(me.player.aliveMs ?? 0)} ref={mmss(ref_.player.aliveMs ?? 0)} />
        <Stat label="Casts por minuto" mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref_).toFixed(1)} />
        <Stat label="Item level" mine={me.player.setup?.itemLevel.toFixed(1) ?? '—'} ref={ref_.player.setup?.itemLevel.toFixed(1) ?? '—'} />
      </div>

      {full && links.length > 0 && (
        <p className="perf-card-links small">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
              {l.who}: {l.label}
            </a>
          ))}
        </p>
      )}

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>Pontos principais</h4>
          <ul className="perf-insights">
            {insights.map((i, k) => (
              <li key={k} className={`tone-${i.tone}`}>
                {i.spellId != null && <SpellIcon spellId={i.spellId} size={16} />}
                {i.text}
              </li>
            ))}
            {!full && allInsights.length > insights.length && <li className="share-more">+{allInsights.length - insights.length} no relatório completo</li>}
          </ul>
        </section>
      )}

      {windows.length > 0 && (
        <section className="perf-section">
          <h4>Janelas de burst</h4>
          {windows.map((w) => (
            <div key={burstKey(w)} className="perf-card-burst">
              <span className="perf-card-burst-title">
                <SpellName spellId={w.spellId} name={`${w.name} ${w.index}`} size={16} />
                <span className="muted small"> {w.mine ? mmss(w.mine.start) : 'não usou'}</span>
              </span>
              <BurstCompare w={w} />
            </div>
          ))}
        </section>
      )}

      <CooldownCompare me={me} ref_={ref_} cds={cds} expanded={full} coreOnly={!full} />
      {full && (
        <>
          <Rotation me={me} ref_={ref_} cds={cds} expanded />
          <Potions me={me} ref_={ref_} />
          <SetupView me={me.player} ref_={ref_.player} />
        </>
      )}

      <footer className="share-foot">
        <span className="share-muted">Por minuto vivo; cooldowns no tempo em que os dois estavam vivos.{full ? ' Relatório completo.' : ''}</span>
        <Brand />
      </footer>
    </div>
  );
}

