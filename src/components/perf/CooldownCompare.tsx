import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { mmss } from '../../lib/format';
import { CD_LATE_MS, COOLDOWN_MIN_GAP_MS, compareCooldowns, type CooldownInfo, type CooldownRow, type Sample } from '../../lib/performance';
import { SpellName } from '../SpellIcon';
import { messagesOf } from '../../i18n';
import { perfViewMsg } from './perf.i18n';

export const signedSec = (ms: number) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return s === 0 ? '0s' : `${ms > 0 ? '+' : '−'}${s}s`;
};

/**
 * Cooldowns dos dois lado a lado, no tempo em que ambos estavam vivos: os da lista da classe
 * (inclusive os menores) e os de uso frequente; os de ocasião ficam atrás de um botão.
 * `expanded`: tudo aberto e sem botões (cartão completo); `coreOnly`: só os principais e sem
 * botões (cartão resumo).
 */
export function CooldownCompare({
  me,
  ref_,
  cds,
  refName = messagesOf(perfViewMsg).referenceLower,
  expanded = false,
  coreOnly = false,
}: {
  me: Sample;
  ref_: Sample;
  cds: Map<number, CooldownInfo>;
  refName?: string;
  expanded?: boolean;
  coreOnly?: boolean;
}) {
  const { windowMs, rows: all } = compareCooldowns(me, ref_, cds);
  // usado só fora do tempo em que os dois estavam vivos: nada a comparar
  const rows = all.filter((r) => r.mine.length + r.ref.length > 0);
  const [open, setShowAll] = useState(false);
  const showAll = (open || expanded) && !coreOnly;
  if (rows.length === 0) return null;
  const core = rows.filter((r) => r.core);
  const shown = showAll || core.length === 0 ? rows : core;
  const toggle = !expanded && !coreOnly && core.length > 0 && core.length < rows.length;
  const t = messagesOf(perfViewMsg);
  return (
    <section className="perf-section">
      <h4>
        {t.cooldowns} <span className="muted small">{t.cdWindow(mmss(windowMs))}</span>
      </h4>
      <div className="cd-legend small">
        <span className="cd-dot mine" /> {t.you} <span className="cd-dot ref" /> {refName}
        <span className="muted">{t.cdLegendHint}</span>
      </div>
      <div className="cd-rows">
        {shown.map((r) => (
          <CooldownLine key={r.spellId} r={r} windowMs={windowMs} refName={refName} />
        ))}
      </div>
      {toggle && (
        <button className="link small more-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showAll ? 'open' : ''}`} aria-hidden />
          {showAll ? t.onlyMain : t.showOccasional(rows.length - core.length)}
        </button>
      )}
    </section>
  );
}

function CooldownLine({ r, windowMs, refName }: { r: CooldownRow; windowMs: number; refName: string }) {
  const at = (t: number) => `${Math.min(100, (t / windowMs) * 100)}%`;
  // recarga curta: um uso de diferença e o 1º uso fora de hora são ruído
  const short = r.gapMs != null && r.gapMs < COOLDOWN_MIN_GAP_MS;
  const fewer = r.core && r.ref.length - r.mine.length >= (short ? 2 : 1);
  const late = r.core && !short && r.firstDelta != null && Math.abs(r.firstDelta) > CD_LATE_MS;
  const t = messagesOf(perfViewMsg);
  const title = [r.possible ? t.cdFitTitle(r.possible) : null, r.gapMs ? t.cdRecharge(Math.round(r.gapMs / 1000)) : null].filter(Boolean).join(' · ');
  return (
    <div className="cd-row">
      <SpellName spellId={r.spellId} name={r.name} size={16} />
      <div className="cd-track" role="img" aria-label={t.ariaUses(r.mine.map(mmss).join(', ') || t.notUsed, refName, r.ref.map(mmss).join(', ') || t.notUsed)}>
        <div className="cd-lane">
          {r.mine.map((t, i) => (
            <span key={i} className="cd-mark mine" style={{ left: at(t) }} title={`${messagesOf(perfViewMsg).you}: ${mmss(t)}`} />
          ))}
        </div>
        <div className="cd-lane">
          {r.ref.map((t, i) => (
            <span key={i} className="cd-mark ref" style={{ left: at(t) }} title={`${refName}: ${mmss(t)}`} />
          ))}
        </div>
      </div>
      <span className={`cd-count num small ${fewer ? 'bad' : ''}`} title={title || undefined}>
        {r.mine.length} × {r.ref.length}
        {r.possible ? <span className="muted"> /{r.possible}</span> : null}
      </span>
      <span className={`cd-delta num small ${late ? 'warn' : 'muted'}`} title={t.firstUseTitle(refName)}>
        {r.firstDelta != null ? t.firstUse(signedSec(r.firstDelta)) : ''}
      </span>
    </div>
  );
}
