// Heurísticas genéricas de "por que deu wipe". Regras específicas de boss virão de encounters/*.yaml.

import type { Death, Pull } from '../types';
import { mmss, pct, shortName } from './format';

export type Severity = 'wipe' | 'major' | 'minor' | 'info';

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
  /** guid do player envolvido, para destacar na lista de mortes */
  player?: string;
}

export interface Verdict {
  headline: string;
  findings: Finding[];
  /** Mortes que aconteceram antes do efeito cascata (as que importam) */
  decisiveDeaths: Death[];
}

/** Quantas mortes contam como "decisivas" antes de considerar o resto como cascata. */
function cascadeThreshold(p: Pull): number {
  const raid = p.players.length || p.groupSize || 20;
  return Math.max(2, Math.ceil(raid * 0.2));
}

export function lowestBossHp(p: Pull): number | null {
  const hps = p.bosses.map((b) => b.hpPct).filter((x): x is number => x != null);
  return hps.length ? Math.min(...hps) : null;
}

export function analyzePull(p: Pull): Verdict {
  const findings: Finding[] = [];
  const deaths = [...p.deaths].sort((a, b) => a.t - b.t);
  const decisive = deaths.slice(0, cascadeThreshold(p));
  const bossHp = lowestBossHp(p);

  // 1. Mortes decisivas agrupadas pelo golpe final
  const byKiller = new Map<string, Death[]>();
  for (const d of decisive) {
    const key = d.killingBlow?.spellName ?? 'Desconhecido';
    byKiller.set(key, [...(byKiller.get(key) ?? []), d]);
  }
  const ranked = [...byKiller.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [spell, ds] of ranked) {
    if (ds.length >= 2) {
      findings.push({
        severity: 'wipe',
        title: `${ds.length} das primeiras mortes foram por ${spell}`,
        detail: ds.map((d) => `${shortName(d.name)} (${mmss(d.t)})`).join(', '),
      });
    }
  }

  // 2. Tank morrendo cedo costuma ser a causa direta
  for (const d of decisive.filter((d) => d.role === 'tank')) {
    findings.push({
      severity: 'wipe',
      title: `Tank ${shortName(d.name)} morreu aos ${mmss(d.t)}`,
      detail: d.killingBlow ? `Golpe final: ${d.killingBlow.spellName} (${d.killingBlow.source})` : undefined,
      player: d.guid,
    });
  }

  // 3. Sobrevivência de cada morte decisiva
  for (const d of decisive) {
    const who = shortName(d.name);
    if (d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0) {
      findings.push({
        severity: 'major',
        title: `${who} morreu sem defensivo`,
        detail: `Disponível: ${d.defensivesAvailable.map((a) => a.name).join(', ')}`,
        player: d.guid,
      });
    }
    const missing = [
      !d.usedHealthstone && d.healthstoneKnown ? 'healthstone' : null,
      !d.usedHealthPotion ? 'poção de vida' : null,
    ].filter(Boolean);
    if (missing.length) {
      findings.push({ severity: 'minor', title: `${who} não usou ${missing.join(' nem ')}`, player: d.guid });
    }
  }

  // 4. Sem mortes relevantes e boss vivo: provavelmente dano (enrage/soft enrage) ou reset
  if (!p.success && deaths.length < 2 && bossHp != null && bossHp > 0) {
    findings.push({
      severity: 'info',
      title: `Wipe com poucas mortes e boss em ${pct(bossHp)}`,
      detail: 'Pode ser enrage (falta de dano) ou reset manual. Compare o DPS com os outros pulls.',
    });
  }

  const first = deaths[0];
  let headline: string;
  if (p.success) {
    headline = `Kill em ${mmss(p.durationMs)}${deaths.length ? ` com ${deaths.length} morte(s)` : ''}`;
  } else if (first) {
    const kb = first.killingBlow ? ` para ${first.killingBlow.spellName}` : '';
    headline = `Wipe${bossHp != null ? ` com boss em ${pct(bossHp)}` : ''} — começou com ${shortName(first.name)} morrendo${kb} aos ${mmss(first.t)}`;
  } else {
    headline = `Wipe${bossHp != null ? ` com boss em ${pct(bossHp)}` : ''} sem mortes`;
  }

  const order: Record<Severity, number> = { wipe: 0, major: 1, minor: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { headline, findings, decisiveDeaths: decisive };
}
