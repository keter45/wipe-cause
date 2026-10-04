// Dossiê de um pull para a IA: tudo o que o app sabe da luta, em texto enxuto (cabe folgado
// no contexto dos modelos gratuitos). A IA só pode responder com base nisto.

import type { Death, Pull } from '../types';
import { assignmentsFor, checkAssignments, type Assignments } from './assignments';
import { mmss, num, pct, ROLE_LABEL, shortName } from './format';
import { scorePull } from './score';
import { analyzePull, lowestBossHp, lowestBossHpAtEnd } from './verdict';
import { deathKey, massDeathKeys, MASS_DEATH_MIN } from './massDeaths';
import { getNote } from './notes';
import { getMarks } from './marks';
import { tr } from '../i18n';

const SEVERITY: Record<string, string> = { wipe: 'causa wipe', major: 'grave', minor: 'leve', none: 'info' };
const KIND: Record<string, string> = {
  avoidable_damage: 'dano evitável',
  stack_limit: 'limite de stacks',
  soak: 'soak',
  tank_soak: 'soak de tank',
  interrupt: 'interrupt',
  tank_range: 'alcance do tank',
  positioning: 'posicionamento',
  enrage: 'enrage',
  failure_event: 'falha do raid (explosão/timer)',
  dispel: 'dispel',
  spread: 'espalhar',
  hp_balance: 'HP dos bosses',
  cc_required: 'CC',
  add_kill: 'matar adds',
  info: 'info',
  unavoidable: 'inevitável',
};

/** Limites para não estourar o contexto dos modelos gratuitos. */
const MAX_DEATHS_DETAILED = 12;
const MAX_TIMELINE = 40;
const MAX_MECH_EVENTS = 6;

export const SYSTEM_PROMPT = `Você é um analista de raid de World of Warcraft ajudando uma guilda brasileira a entender por que deu wipe e o que cada um pode melhorar.

Regras:
- Responda em português do Brasil, direto e prático, como um raid leader experiente.
- Use SOMENTE os dados do dossiê abaixo (gerado a partir do combat log). Se a resposta não está nos dados, diga que o log não mostra isso — não invente mecânicas, números ou acontecimentos.
- Cite nomes e momentos (m:ss) sempre que possível.
- Ao sugerir melhorias, seja específico: quem, quando e o que fazer diferente. Priorize o que mais pesou no wipe.
- As "dicas" das mecânicas vêm das regras do boss no app: use-as para explicar o que deveria ter acontecido.
- Mortes depois do corte ("ignorar após N mortes") são efeito cascata: não culpe ninguém por elas.
- Mortes marcadas [wipe geral] (muita gente morrendo junta) são consequência de uma falha coletiva: aponte a falha e quem a causou, não cada morto.
- Seja conciso (até ~250 palavras), a menos que peçam detalhes. Use listas curtas quando ajudar.`;

function deathLine(d: Death, byGuid: Map<string, Pull['players'][number]>): string {
  const p = byGuid.get(d.guid);
  const who = `${shortName(d.name)} (${d.role ? ROLE_LABEL[d.role] : '?'}${p?.class ? `, ${p.class}` : ''})`;
  const kb = d.killingBlow ? `golpe final ${d.killingBlow.spellName} ${num(d.killingBlow.amount)} de ${d.killingBlow.source}` : 'golpe final desconhecido';
  const parts = [
    kb,
    d.causedBy ? `causa: ${d.causedBy.name} (${Math.round(d.causedBy.pct)}% do dano recebido)` : null,
    d.deathKind === 'spike' ? 'morte em spike' : d.deathKind === 'slow' ? `morte lenta (${d.stats.belowHalfMs != null ? `${Math.round(d.stats.belowHalfMs / 1000)}s abaixo de 50%` : ''})` : null,
    d.stats.underhealed ? `pouca cura (recebeu ${Math.round(d.stats.healingPctOfMax10s ?? 0)}% do HP em 10s)` : null,
    d.defensivesRecent.length
      ? `usou ${d.defensivesRecent.map((x) => x.name).join(', ')}`
      : d.defensivesAvailable.length
        ? `sem defensivo (tinha ${d.defensivesAvailable.map((x) => x.name).join(', ')})`
        : 'sem defensivo disponível',
    d.usedHealthPotion ? 'usou poção' : 'não usou poção',
    d.usedHealthstone ? 'usou healthstone' : d.healthstoneKnown ? 'tinha healthstone e não usou' : null,
    d.debuffs?.length ? `debuffs: ${d.debuffs.map((a) => `${a.name}${a.stacks > 1 ? ` x${a.stacks}` : ''}`).join(', ')}` : null,
  ].filter(Boolean);

  // posição: distância do boss e quem estava perto
  const snap = d.positions;
  const me = snap?.units.find((u) => u.guid === d.guid);
  const boss = snap?.units.find((u) => u.kind === 'enemy');
  if (snap && me) {
    const near = snap.units.filter((u) => u.kind === 'player' && u.guid !== me.guid && Math.hypot(u.x - me.x, u.y - me.y) <= 8).map((u) => shortName(u.name));
    parts.push(
      `posição: ${boss ? `${Math.round(Math.hypot(me.x - boss.x, me.y - boss.y))} jd do ${boss.name}` : 'sem boss na foto'}, ${near.length ? `perto de ${near.join(', ')}` : 'ninguém a menos de 8 jd'}`,
    );
  }
  // últimos golpes recebidos
  const hits = (d.recap ?? [])
    .filter((e) => e.kind === 'damage')
    .slice(-5)
    .map((e) => `${((e.t - d.t) / 1000).toFixed(1)}s ${e.spellName} ${num(e.amount + e.absorbed)}${e.hpPct != null ? ` (HP ${Math.round(e.hpPct)}%)` : ''}`);
  if (hits.length) parts.push(`últimos golpes: ${hits.join('; ')}`);
  return `${mmss(d.t)} ${who} — ${parts.join('; ')}`;
}

/**
 * Dossiê do pull. `nightPulls`: todos os pulls do mesmo boss na noite (resumo em uma linha
 * cada), para perguntas como "o que mudou do pull anterior?".
 */
export function pullContext(p: Pull, nightPulls: Pull[] = [], assignments: Assignments = assignmentsFor(p)): string {
  const v = analyzePull(p, assignments);
  const scores = scorePull(p, assignments);
  const byGuid = new Map(p.players.map((x) => [x.guid, x]));
  const hp = lowestBossHp(p);
  const out: string[] = [];

  const idx = nightPulls.findIndex((x) => x.id === p.id);
  out.push(`# ${p.encounterName} (${p.difficultyName}) — pull ${p.pullNumber}${nightPulls.length ? ` de ${nightPulls.length} deste boss na noite` : ''}`);
  out.push(
    [
      p.success ? `Resultado: KILL em ${mmss(p.durationMs)}.` : `Resultado: wipe com boss em ${pct(hp)} (duração ${mmss(p.durationMs)}).`,
      p.cutoffT != null
        ? `Corte: após a ${p.deaths.filter((d) => !d.ignored).length}ª morte (${mmss(p.cutoffT)}) o app ignora o resto (cascata); no fim do pull o boss estava em ${pct(lowestBossHpAtEnd(p))}.`
        : null,
      `${p.players.length} players. Bosses: ${p.bosses.map((b) => `${b.name} ${pct(p.cutoffT != null ? (b.hpPctAtCutoff ?? b.hpPct) : b.hpPct)}`).join(', ')}.`,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const note = getNote(p).trim();
  if (note) out.push(`Anotação da raid sobre este pull (o que eles perceberam na hora): "${note}"`);
  const marks = getMarks(p);
  if (marks.length)
    out.push(`Erros marcados à mão pelo raid leader (não vêm do log): ${marks.map((m) => `${shortName(m.name)} — ${m.what}${m.t != null ? ` (${mmss(m.t)})` : ''}`).join('; ')}`);
  out.push(`Veredito do app: ${v.headline}`);
  if (v.findings.length) out.push('Achados do app:\n' + v.findings.slice(0, 12).map((f) => `- [${SEVERITY[f.severity] ?? f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ''}`).join('\n'));

  // mecânicas do boss (regras): o que é cada uma e o que aconteceu neste pull
  if (p.mechanics.length) {
    out.push('\n## Mecânicas do boss (regras do app) e o que aconteceu');
    const failed = p.mechanics.filter((m) => m.failures > 0);
    const rest = p.mechanics.filter((m) => m.failures === 0);
    for (const m of failed) {
      const blamed = m.players.filter((x) => !x.credit);
      const credit = m.players.filter((x) => x.credit);
      const lines = [
        `- ${m.name} [${KIND[m.kind] ?? m.kind}, ${SEVERITY[m.severity] ?? m.severity}] — FALHOU ${m.failures}×.${tr(m.summary) ? ` ${tr(m.summary)}.` : ''}${tr(m.tip) ? ` Dica: ${tr(m.tip)}` : ''}`,
      ];
      if (blamed.length) lines.push(`  Envolvidos: ${blamed.map((x) => `${shortName(x.name)} (${m.kind === 'stack_limit' ? `${x.count} stacks` : `${x.count}×`}${x.firstT != null ? `, 1ª vez ${mmss(x.firstT)}` : ''})`).join(', ')}`);
      if (credit.length) lines.push(`  Ajudaram/cortaram: ${credit.map((x) => `${shortName(x.name)} (${x.count})`).join(', ')}`);
      if (m.dispels?.length)
        lines.push(`  Dispels: ${m.dispels.map((d) => `${shortName(d.target)} ${d.delayMs == null ? 'sem dispel' : `${(d.delayMs / 1000).toFixed(1)}s por ${shortName(d.dispelledBy ?? '?')}`}`).join('; ')}`);
      if (m.events?.length) lines.push(`  Eventos: ${m.events.slice(0, MAX_MECH_EVENTS).map((e) => `${mmss(e.t)} ${e.player ? `${shortName(e.player)} ` : ''}${tr(e.detail)}`).join('; ')}`);
      out.push(lines.join('\n'));
    }
    if (rest.length) out.push(`Sem falhas: ${rest.map((m) => `${m.name}${tr(m.tip) ? ` (${tr(m.tip)})` : ''}`).join('; ')}`);
  }

  // interrupts: casts que passaram e escala
  const kicks = p.mechanics.filter((m) => m.kind === 'interrupt' && m.casts?.length);
  for (const m of kicks) {
    const groups = assignments.get(m.key);
    const cut = m.casts!.filter((c) => c.interruptedBy).length;
    let line = `\n## Interrupts — ${m.name}: ${cut} cortados, ${m.casts!.length - cut} passaram.`;
    if (groups?.length) {
      const r = checkAssignments(m, groups);
      line += ` Escala: ${groups.map((g, i) => `add ${i + 1}: ${g.join(' → ')}`).join(' · ')}.`;
      line += `\n` + r.casts.map((c) => `${mmss(c.t)} vez de ${c.assigned ?? '?'} → ${c.by ?? 'PASSOU'}`).join('; ');
    } else {
      line += `\n` + m.casts!.map((c) => `${mmss(c.t)} ${c.interruptedBy ? `cortado por ${shortName(c.interruptedBy)}` : 'PASSOU'}`).join('; ');
    }
    out.push(line);
  }

  // mortes
  const counted = p.deaths.filter((d) => !d.ignored);
  const ignored = p.deaths.filter((d) => d.ignored);
  if (counted.length) {
    out.push(`\n## Mortes que contam (${counted.length})`);
    const mass = massDeathKeys(p.deaths);
    const tag = (d: Death) => (mass.has(deathKey(d)) ? `[wipe geral: ${MASS_DEATH_MIN}+ mortes juntas] ` : '');
    out.push(counted.slice(0, MAX_DEATHS_DETAILED).map((d) => `- ${tag(d)}${deathLine(d, byGuid)}`).join('\n'));
  }
  if (ignored.length) out.push(`Mortes depois do corte (cascata, não contam): ${ignored.map((d) => `${shortName(d.name)} ${mmss(d.t)}`).join(', ')}`);

  // linha do tempo resumida
  const timeline: [number, string][] = [];
  if (p.trigger) timeline.push([p.trigger.t, `GATILHO do wipe: ${p.trigger.name} (${p.trigger.deaths} mortes ligadas)`]);
  for (const m of p.mechanics) for (const e of (m.events ?? []).slice(0, MAX_MECH_EVENTS)) timeline.push([e.t, `${m.name}: ${e.player ? `${shortName(e.player)} ` : ''}${tr(e.detail)}`]);
  for (const d of counted) timeline.push([d.t, `morre ${shortName(d.name)}`]);
  timeline.sort((a, b) => a[0] - b[0]);
  if (timeline.length) out.push('\n## Linha do tempo\n' + timeline.slice(0, MAX_TIMELINE).map(([t, s]) => `${mmss(t)} ${s}`).join('\n'));

  // jogadores
  out.push('\n## Jogadores (nota 0-100 do app: desconta erros, vez perdida na escala e morte decisiva; morte em wipe geral não conta)');
  const players = [...p.players].sort((a, b) => (scores.get(a.guid)?.score ?? 100) - (scores.get(b.guid)?.score ?? 100));
  for (const x of players) {
    const s = scores.get(x.guid);
    const out1 = [
      `${shortName(x.name)} (${x.role ? ROLE_LABEL[x.role] : '?'}${x.class ? `, ${x.class}` : ''})`,
      `nota ${s?.score ?? 100}`,
      x.role === 'healer' ? `HPS ${num(x.hps)}` : `DPS ${num(x.dps)}`,
      `dano tomado ${num(x.damageTaken)}`,
      x.deaths ? `${x.deaths} morte(s)` : null,
      x.canInterrupt ? `interrupts ${x.interrupts}/${x.interruptAttempts}` : null,
      x.defensivesUsed.length ? `defensivos: ${x.defensivesUsed.map((u) => `${u.name} ${mmss(u.t)}`).join(', ')}` : 'nenhum defensivo',
      x.healthPotions || x.healthstones ? `poção ${x.healthPotions}, healthstone ${x.healthstones}` : null,
      s?.parts.length ? `descontos: ${s.parts.join('; ')}` : null,
    ].filter(Boolean);
    out.push(`- ${out1.join(' | ')}`);
  }

  // habilidades do boss que mais machucaram
  const spells = [...p.enemySpells].sort((a, b) => b.damageToPlayers - a.damageToPlayers).slice(0, 10);
  if (spells.length) out.push('\n## Habilidades do boss (dano no raid)\n' + spells.map((e) => `- ${e.name}: ${num(e.damageToPlayers)} em ${e.hitsOnPlayers} hits${e.casts ? `, ${e.casts} casts` : ''}${e.interruptible ? ` (interrompível, ${e.interrupted} cortados)` : ''}`).join('\n'));

  // outros pulls do boss na noite
  if (nightPulls.length > 1) {
    out.push('\n## Outros pulls deste boss na noite');
    for (const q of nightPulls) {
      const qv = q.success ? 'KILL' : `wipe ${pct(lowestBossHp(q))}`;
      out.push(`- pull ${q.pullNumber}${q.id === p.id ? ' (ESTE)' : ''}: ${qv}, ${mmss(q.durationMs)}${q.trigger ? `, gatilho ${q.trigger.name}` : ''}, ${q.deaths.filter((d) => !d.ignored).length} mortes`);
    }
    if (idx > 0) out.push(`Pull anterior a este: ${nightPulls[idx - 1].pullNumber}.`);
  }
  return out.join('\n');
}

/** Perguntas prontas para começar a conversa. */
export const SUGGESTED = [
  'Por que deu wipe? Explique a cadeia de eventos.',
  'O que cada player precisa melhorar neste pull?',
  'O que devemos mudar no próximo pull?',
  'Os healers deram conta? Alguém morreu por falta de cura?',
  'Quem morreu com defensivo sobrando e quando deveria ter usado?',
  'Comparado aos outros pulls da noite, estamos melhorando?',
];

/** Estimativa grosseira de tokens (≈ 4 caracteres por token). */
export const estimateTokens = (s: string) => Math.round(s.length / 4);
