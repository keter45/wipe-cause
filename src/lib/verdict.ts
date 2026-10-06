// Heurísticas genéricas de "por que deu wipe". Regras específicas de boss virão de encounters/*.yaml.

import type { Death, Pull } from '../types';
import { mmss, pct, shortName, damageSource } from './format';
import { assignmentsFor, checkAssignments, type Assignments } from './assignments';
import { spellIdByName } from './spells';
import { getMarks } from './marks';
import { messagesOf, tr } from '../i18n';
import { verdictMsg } from './verdict.i18n';

export type Severity = 'wipe' | 'major' | 'minor' | 'info';

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
  /** guid do player envolvido, para destacar na lista de mortes */
  player?: string;
  /** habilidade do achado (ícone) */
  spellId?: number | null;
  /** mecânica marcada como foco da progressão */
  focus?: boolean;
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

const CASCADE_WINDOW_MS = 20_000;
const MAX_DECISIVE = 6;

/**
 * Mortes que importam: as isoladas antes da cascata + as 2 primeiras da cascata.
 * Cascata = primeira janela de 20s com `threshold` mortes ou mais.
 */
export function decisiveDeaths(sorted: Death[], threshold: number): Death[] {
  const start = sorted.findIndex((d) => sorted.filter((x) => x.t >= d.t && x.t - d.t <= CASCADE_WINDOW_MS).length >= threshold);
  if (start < 0) return sorted.slice(0, threshold);
  const isolated = sorted.slice(0, start).slice(0, MAX_DECISIVE - 2);
  return [...isolated, ...sorted.slice(start, start + 2)];
}

/** HP do boss mais baixo: no corte ("ignorar após N mortes"), se houver; kill = 0. */
export function lowestBossHp(p: Pull): number | null {
  if (p.success) return 0;
  const hps = p.bosses.map((b) => (p.cutoffT != null ? b.hpPctAtCutoff ?? b.hpPct : b.hpPct)).filter((x): x is number => x != null);
  return hps.length ? Math.min(...hps) : null;
}

/** HP do boss mais baixo no fim do pull (depois da cascata), para referência. */
export function lowestBossHpAtEnd(p: Pull): number | null {
  const hps = p.bosses.map((b) => b.hpPct).filter((x): x is number => x != null);
  return hps.length ? Math.min(...hps) : null;
}

/** `assignments`: escala de interrupts (padrão: a salva para o boss). */
export function analyzePull(p: Pull, assignments: Assignments = assignmentsFor(p)): Verdict {
  const t = messagesOf(verdictMsg);
  const findings: Finding[] = [];
  const deaths = [...p.deaths].sort((a, b) => a.t - b.t);
  // com "ignorar após N mortes" ligado, as decisivas são as N primeiras; senão, janela de cascata
  const decisive = p.cutoffT != null ? deaths.filter((d) => !d.ignored) : decisiveDeaths(deaths, cascadeThreshold(p));
  const bossHp = lowestBossHp(p);

  // 0. Regras do boss: falhas de mecânica graves entram primeiro (e as do foco, mesmo leves)
  for (const m of p.mechanics) {
    if (m.failures === 0 || m.severity === 'none' || (m.severity === 'minor' && !m.focus)) continue;
    const blamed = m.players.filter((x) => !x.credit);
    findings.push({
      severity: m.severity === 'minor' ? 'major' : m.severity,
      focus: m.focus,
      spellId: m.spellId,
      title: tr(m.summary) || t.mechanicPlayers(m.name, blamed.length),
      detail: tr(m.summary)
        ? tr(m.tip)
        : blamed
            .slice(0, 4)
            .map((x) => tr(x.message) || shortName(x.name))
            .join(' · ') + (blamed.length > 4 ? ` · +${blamed.length - 4}` : ''),
    });
  }

  // 0b. Erros marcados à mão pelo raid leader (o que o log não prova)
  for (const mk of getMarks(p)) {
    findings.push({
      severity: mk.severity,
      spellId: mk.spellId ?? null,
      title: `${shortName(mk.name)}: ${mk.what}`,
      detail: t.markedByRaid(mk.t != null ? mmss(mk.t) : null),
      player: mk.guid,
    });
  }

  // 1. Mortes decisivas agrupadas pelo golpe final
  const byKiller = new Map<string, Death[]>();
  for (const d of decisive) {
    const key = d.killingBlowMechanic ?? d.killingBlow?.spellName ?? t.unknown;
    byKiller.set(key, [...(byKiller.get(key) ?? []), d]);
  }
  const ranked = [...byKiller.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [spell, ds] of ranked) {
    if (ds.length >= 2) {
      findings.push({
        severity: 'wipe',
        spellId: spellIdByName(p, spell) ?? ds[0].killingBlow?.spellId ?? null,
        title: t.firstDeathsBy(ds.length, spell),
        detail: ds.map((d) => `${shortName(d.name)} (${mmss(d.t)})`).join(', '),
      });
    }
  }

  // 2. Tank morrendo cedo costuma ser a causa direta
  for (const d of decisive.filter((d) => d.role === 'tank')) {
    findings.push({
      severity: 'wipe',
      spellId: d.killingBlow?.spellId ?? null,
      title: t.tankDied(shortName(d.name), mmss(d.t)),
      detail: d.killingBlow ? t.killingBlow(d.killingBlow.spellName, damageSource(d.killingBlow.source)) : undefined,
      player: d.guid,
    });
  }

  // 3. Sobrevivência de cada morte decisiva (uma vez por player, mesmo com battle rez)
  const seen = new Set<string>();
  for (const d of decisive) {
    if (seen.has(d.guid)) continue;
    seen.add(d.guid);
    const who = shortName(d.name);
    if (d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0) {
      findings.push({
        severity: 'major',
        title: t.noDefensive(who),
        detail: t.available(d.defensivesAvailable.map((a) => a.name).join(', ')),
        player: d.guid,
      });
    }
    const missing = [
      !d.usedHealthstone && d.healthstoneKnown ? t.healthstone : null,
      !d.usedHealthPotion ? t.healthPotion : null,
    ].filter((x): x is string => !!x);
    if (missing.length) {
      findings.push({ severity: 'minor', title: t.didNotUse(who, missing), player: d.guid });
    }
  }

  // 3b. Morte lenta: o player ficou muito tempo com pouca vida
  const seenSlow = new Set<string>();
  for (const d of decisive.filter((d) => d.deathKind === 'slow')) {
    if (seenSlow.has(d.guid)) continue;
    seenSlow.add(d.guid);
    const below = d.stats.belowHalfMs != null ? t.belowHalf(Math.round(d.stats.belowHalfMs / 1000)) : '';
    const heal = d.stats.healingPctOfMax10s != null ? t.healReceived(Math.round(d.stats.healingPctOfMax10s)) : '';
    findings.push({
      severity: d.stats.underhealed ? 'major' : 'minor',
      title: t.slowDeath(shortName(d.name), d.stats.underhealed),
      detail: [below, heal].filter(Boolean).join(' · '),
      player: d.guid,
    });
  }

  // 3c. Casts interrompíveis que passaram
  const passed = p.enemySpells.filter((e) => e.interruptible && e.casts > 0);
  if (passed.length) {
    const idle = p.players.filter((x) => x.canInterrupt && x.interrupts === 0).map((x) => shortName(x.name));
    // com escala: de quem era a vez em cada cast que passou
    const missed = new Map<string, number>();
    for (const m of p.mechanics.filter((m) => m.kind === 'interrupt')) {
      const groups = assignments.get(m.key);
      if (!groups?.length) continue;
      for (const k of checkAssignments(m, groups).kickers) if (k.missed) missed.set(k.name, (missed.get(k.name) ?? 0) + k.missed);
    }
    findings.push({
      severity: 'major',
      spellId: passed[0].spellId,
      title: t.castsPassed(
        passed.reduce((n, e) => n + e.casts, 0),
        passed.map((e) => `${e.name} ${e.casts}×`).join(', '),
      ),
      detail: missed.size ? t.missedTurn([...missed].map(([n, c]) => (c > 1 ? `${n} (${c})` : n)).join(', ')) : idle.length ? t.idle(idle.join(', ')) : undefined,
    });
  }

  // 4. Sem mortes relevantes e boss vivo: provavelmente dano (enrage/soft enrage) ou reset
  if (!p.success && deaths.length < 2 && bossHp != null && bossHp > 0) {
    findings.push({
      severity: 'info',
      title: t.fewDeaths(pct(bossHp)),
      detail: t.fewDeathsDetail,
    });
  }

  const first = deaths[0];
  let headline: string;
  const boss = t.bossAt(bossHp != null ? pct(bossHp) : null);
  if (p.success) {
    headline = t.kill(mmss(p.durationMs), deaths.length);
  } else if (p.trigger) {
    const trig = p.trigger;
    headline = t.wipeTrigger(boss, trig.name, mmss(trig.t), trig.deaths);
  } else if (first) {
    headline = t.wipeFirstDeath(boss, shortName(first.name), first.killingBlow?.spellName ?? null, mmss(first.t));
  } else {
    headline = t.wipeNoDeaths(boss);
  }

  const order: Record<Severity, number> = { wipe: 0, major: 1, minor: 2, info: 3 };
  // o foco da progressão vem antes de tudo; depois, pela gravidade
  findings.sort((a, b) => Number(!!b.focus) - Number(!!a.focus) || order[a.severity] - order[b.severity]);
  return { headline, findings, decisiveDeaths: decisive };
}
