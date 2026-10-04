// Dossiê de um pull para a IA: tudo o que o app sabe da luta, em texto enxuto (cabe folgado
// no contexto dos modelos gratuitos). A IA só pode responder com base nisto. Sai no idioma do
// app, e a IA responde nele.

import type { Death, Pull } from '../types';
import { assignmentsFor, checkAssignments, type Assignments } from './assignments';
import { mmss, num, pct, ROLE_LABEL, shortName } from './format';
import { scorePull } from './score';
import { analyzePull, lowestBossHp, lowestBossHpAtEnd } from './verdict';
import { deathKey, massDeathKeys, MASS_DEATH_MIN } from './massDeaths';
import { getNote } from './notes';
import { getMarks } from './marks';
import { phaseLabel } from './phases';
import { messagesOf, tr } from '../i18n';
import { aiMsg } from './aiContext.i18n';

/** Limites para não estourar o contexto dos modelos gratuitos. */
const MAX_DEATHS_DETAILED = 12;
const MAX_TIMELINE = 40;
const MAX_MECH_EVENTS = 6;

/** Instruções da IA, no idioma do app. */
export const systemPrompt = () => messagesOf(aiMsg).system;
/** Título do dossiê dentro da mensagem de sistema. */
export const dossierTitle = () => messagesOf(aiMsg).dossierTitle;
/** Perguntas prontas para começar a conversa. */
export const suggestedQuestions = () => messagesOf(aiMsg).suggested;

function deathLine(d: Death, byGuid: Map<string, Pull['players'][number]>): string {
  const t = messagesOf(aiMsg);
  const p = byGuid.get(d.guid);
  const who = `${shortName(d.name)} (${d.role ? ROLE_LABEL[d.role] : '?'}${p?.class ? `, ${p.class}` : ''})`;
  const kb = d.killingBlow ? t.killingBlow(d.killingBlow.spellName, num(d.killingBlow.amount), d.killingBlow.source) : t.killingBlowUnknown;
  const parts = [
    kb,
    d.causedBy ? t.cause(d.causedBy.name, Math.round(d.causedBy.pct)) : null,
    d.deathKind === 'spike' ? t.spike : d.deathKind === 'slow' ? t.slow(d.stats.belowHalfMs != null ? Math.round(d.stats.belowHalfMs / 1000) : null) : null,
    d.stats.underhealed ? t.lowHeal(Math.round(d.stats.healingPctOfMax10s ?? 0)) : null,
    d.defensivesRecent.length
      ? t.usedDefensives(d.defensivesRecent.map((x) => x.name).join(', '))
      : d.defensivesAvailable.length
        ? t.noDefensiveHad(d.defensivesAvailable.map((x) => x.name).join(', '))
        : t.noDefensiveAvailable,
    d.usedHealthPotion ? t.usedPotion : t.noPotion,
    d.usedHealthstone ? t.usedHealthstone : d.healthstoneKnown ? t.unusedHealthstone : null,
    d.debuffs?.length ? t.debuffs(d.debuffs.map((a) => `${a.name}${a.stacks > 1 ? ` x${a.stacks}` : ''}`).join(', ')) : null,
  ].filter(Boolean);

  // posição: distância do boss e quem estava perto
  const snap = d.positions;
  const me = snap?.units.find((u) => u.guid === d.guid);
  const boss = snap?.units.find((u) => u.kind === 'enemy');
  if (snap && me) {
    const near = snap.units.filter((u) => u.kind === 'player' && u.guid !== me.guid && Math.hypot(u.x - me.x, u.y - me.y) <= 8).map((u) => shortName(u.name));
    parts.push(
      t.position(boss ? t.yardsFrom(Math.round(Math.hypot(me.x - boss.x, me.y - boss.y)), boss.name) : t.noBossInSnapshot, near.length ? t.near(near.join(', ')) : t.nobodyNear),
    );
  }
  // últimos golpes recebidos
  const hits = (d.recap ?? [])
    .filter((e) => e.kind === 'damage')
    .slice(-5)
    .map((e) => `${((e.t - d.t) / 1000).toFixed(1)}s ${e.spellName} ${num(e.amount + e.absorbed)}${e.hpPct != null ? ` (HP ${Math.round(e.hpPct)}%)` : ''}`);
  if (hits.length) parts.push(t.lastHits(hits.join('; ')));
  return `${mmss(d.t)} ${who} — ${parts.join('; ')}`;
}

/**
 * Dossiê do pull. `nightPulls`: todos os pulls do mesmo boss na noite (resumo em uma linha
 * cada), para perguntas como "o que mudou do pull anterior?".
 */
export function pullContext(p: Pull, nightPulls: Pull[] = [], assignments: Assignments = assignmentsFor(p)): string {
  const t = messagesOf(aiMsg);
  const sev = (s: string) => t.severity[s] ?? s;
  const v = analyzePull(p, assignments);
  const scores = scorePull(p, assignments);
  const byGuid = new Map(p.players.map((x) => [x.guid, x]));
  const hp = lowestBossHp(p);
  const out: string[] = [];

  const idx = nightPulls.findIndex((x) => x.id === p.id);
  out.push(t.header(p.encounterName, p.difficultyName, p.pullNumber, nightPulls.length));
  out.push(
    [
      p.success ? t.resultKill(mmss(p.durationMs)) : t.resultWipe(pct(hp), mmss(p.durationMs)),
      p.cutoffT != null ? t.cutoff(p.deaths.filter((d) => !d.ignored).length, mmss(p.cutoffT), pct(lowestBossHpAtEnd(p))) : null,
      t.players(p.players.length, p.bosses.map((b) => `${b.name} ${pct(p.cutoffT != null ? (b.hpPctAtCutoff ?? b.hpPct) : b.hpPct)}`).join(', ')),
    ]
      .filter(Boolean)
      .join(' '),
  );
  const note = getNote(p).trim();
  if (note) out.push(t.note(note));
  const marks = getMarks(p);
  if (marks.length) out.push(t.marks(marks.map((m) => `${shortName(m.name)} — ${m.what}${m.t != null ? ` (${mmss(m.t)})` : ''}`).join('; ')));
  out.push(t.verdict(v.headline));
  if (v.findings.length) out.push(`${t.findings}\n` + v.findings.slice(0, 12).map((f) => `- [${sev(f.severity)}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}`).join('\n'));

  // mecânicas do boss (regras): o que é cada uma e o que aconteceu neste pull
  if (p.mechanics.length) {
    out.push(`\n${t.mechanicsTitle}`);
    const failed = p.mechanics.filter((m) => m.failures > 0);
    const rest = p.mechanics.filter((m) => m.failures === 0);
    for (const m of failed) {
      const blamed = m.players.filter((x) => !x.credit);
      const credit = m.players.filter((x) => x.credit);
      const lines = [`- ${m.name} [${t.kind[m.kind] ?? m.kind}, ${sev(m.severity)}] — ${t.failed(m.failures)}${tr(m.summary) ? ` ${tr(m.summary)}.` : ''}${tr(m.tip) ? t.tip(tr(m.tip)) : ''}`];
      if (blamed.length)
        lines.push(t.involved(blamed.map((x) => `${shortName(x.name)} (${m.kind === 'stack_limit' ? t.stacks(x.count) : `${x.count}×`}${x.firstT != null ? t.firstTime(mmss(x.firstT)) : ''})`).join(', ')));
      if (credit.length) lines.push(t.helped(credit.map((x) => `${shortName(x.name)} (${x.count})`).join(', ')));
      if (m.dispels?.length)
        lines.push(t.dispels(m.dispels.map((d) => `${shortName(d.target)} ${d.delayMs == null ? t.noDispel : t.dispelBy((d.delayMs / 1000).toFixed(1), shortName(d.dispelledBy ?? '?'))}`).join('; ')));
      if (m.phases?.length) lines.push(t.phases(m.phases.map((w) => `${mmss(w.start)} ${phaseLabel(w)}${w.deaths ? ` †${w.deaths}` : ''}`).join('; ')));
      if (m.events?.length) lines.push(t.events(m.events.slice(0, MAX_MECH_EVENTS).map((e) => `${mmss(e.t)} ${e.player ? `${shortName(e.player)} ` : ''}${tr(e.detail)}`).join('; ')));
      out.push(lines.join('\n'));
    }
    if (rest.length) out.push(t.clean(rest.map((m) => `${m.name}${tr(m.tip) ? ` (${tr(m.tip)})` : ''}`).join('; ')));
  }

  // interrupts: casts que passaram e escala
  const kicks = p.mechanics.filter((m) => m.kind === 'interrupt' && m.casts?.length);
  for (const m of kicks) {
    const groups = assignments.get(m.key);
    const cut = m.casts!.filter((c) => c.interruptedBy).length;
    let line = `\n${t.kicksTitle(m.name, cut, m.casts!.length - cut)}`;
    if (groups?.length) {
      const r = checkAssignments(m, groups);
      line += t.assignment(groups.map((g, i) => `${t.add(i + 1)}: ${g.join(' → ')}`).join(' · '));
      line += `\n` + r.casts.map((c) => t.turnOf(mmss(c.t), c.assigned ?? '?', c.by ?? t.passedCap)).join('; ');
    } else {
      line += `\n` + m.casts!.map((c) => `${mmss(c.t)} ${c.interruptedBy ? t.cutBy(shortName(c.interruptedBy)) : t.passedCap}`).join('; ');
    }
    out.push(line);
  }

  // mortes
  const counted = p.deaths.filter((d) => !d.ignored);
  const ignored = p.deaths.filter((d) => d.ignored);
  if (counted.length) {
    out.push(`\n${t.deathsTitle(counted.length)}`);
    const mass = massDeathKeys(p.deaths);
    const tag = (d: Death) => (mass.has(deathKey(d)) ? t.massTag(MASS_DEATH_MIN) : '');
    out.push(counted.slice(0, MAX_DEATHS_DETAILED).map((d) => `- ${tag(d)}${deathLine(d, byGuid)}`).join('\n'));
  }
  if (ignored.length) out.push(t.ignoredDeaths(ignored.map((d) => `${shortName(d.name)} ${mmss(d.t)}`).join(', ')));

  // linha do tempo resumida
  const timeline: [number, string][] = [];
  if (p.trigger) timeline.push([p.trigger.t, t.trigger(p.trigger.name, p.trigger.deaths)]);
  for (const m of p.mechanics) for (const e of (m.events ?? []).slice(0, MAX_MECH_EVENTS)) timeline.push([e.t, `${m.name}: ${e.player ? `${shortName(e.player)} ` : ''}${tr(e.detail)}`]);
  for (const d of counted) timeline.push([d.t, t.dies(shortName(d.name))]);
  timeline.sort((a, b) => a[0] - b[0]);
  if (timeline.length) out.push(`\n${t.timelineTitle}\n` + timeline.slice(0, MAX_TIMELINE).map(([time, s]) => `${mmss(time)} ${s}`).join('\n'));

  // jogadores
  out.push(`\n${t.playersTitle}`);
  const players = [...p.players].sort((a, b) => (scores.get(a.guid)?.score ?? 100) - (scores.get(b.guid)?.score ?? 100));
  for (const x of players) {
    const s = scores.get(x.guid);
    const row = [
      `${shortName(x.name)} (${x.role ? ROLE_LABEL[x.role] : '?'}${x.class ? `, ${x.class}` : ''})`,
      t.score(s?.score ?? 100),
      x.role === 'healer' ? `HPS ${num(x.hps)}` : `DPS ${num(x.dps)}`,
      t.damageTaken(num(x.damageTaken)),
      x.deaths ? t.deaths(x.deaths) : null,
      x.canInterrupt ? t.interrupts(x.interrupts, x.interruptAttempts) : null,
      x.defensivesUsed.length ? t.defensives(x.defensivesUsed.map((u) => `${u.name} ${mmss(u.t)}`).join(', ')) : t.noDefensives,
      x.healthPotions || x.healthstones ? t.potions(x.healthPotions, x.healthstones) : null,
      s?.parts.length ? t.penalties(s.parts.join('; ')) : null,
    ].filter(Boolean);
    out.push(`- ${row.join(' | ')}`);
  }

  // habilidades do boss que mais machucaram
  const spells = [...p.enemySpells].sort((a, b) => b.damageToPlayers - a.damageToPlayers).slice(0, 10);
  if (spells.length) out.push(`\n${t.spellsTitle}\n` + spells.map((e) => t.spellLine(e.name, num(e.damageToPlayers), e.hitsOnPlayers, e.casts, e.interruptible, e.interrupted)).join('\n'));

  // outros pulls do boss na noite
  if (nightPulls.length > 1) {
    out.push(`\n${t.otherPullsTitle}`);
    for (const q of nightPulls) {
      const qv = q.success ? 'KILL' : t.wipeAt(pct(lowestBossHp(q)));
      out.push(t.otherPull(q.pullNumber, q.id === p.id, qv, mmss(q.durationMs), q.trigger?.name ?? null, q.deaths.filter((d) => !d.ignored).length));
    }
    if (idx > 0) out.push(t.previous(nightPulls[idx - 1].pullNumber));
  }
  return out.join('\n');
}

/** Estimativa grosseira de tokens (≈ 4 caracteres por token). */
export const estimateTokens = (s: string) => Math.round(s.length / 4);
