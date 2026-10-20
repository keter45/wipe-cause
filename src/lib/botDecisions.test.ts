import { describe, expect, it } from 'vitest';
import * as fx from './test-fixtures';
import { botDecisions } from './botDecisions';
import type { BotRun, BotSeq } from './botSim';
import type { DecisionRef } from './decisions';
import type { BuffTrace, RotationResult } from '../types';

// rotação de mentira: B gera o proc 100, A gasta
const A = 1;
const B = 2;
const PROC = 100;
const rotation = {
  prioritySt: [{ spellId: A, name: 'Alpha' }, { spellId: B, name: 'Beta' }],
  priorityAoe: [],
  cooldowns: [],
} as unknown as RotationResult;

/** O robô: B, A, B, A… com o proc ativo em todo A (e gasto por ele). */
function botSeq(): BotSeq {
  const s: BotSeq = { casts: [], active: [] };
  for (let t = 2000, i = 0; t < 120_000; t += 1500, i++) {
    const id = i % 2 ? A : B;
    s.casts.push([t, id]);
    s.active.push(id === A ? [PROC, 1] : []);
  }
  return s;
}

const run = {
  windowMs: 120_000,
  seqs: Array.from({ length: 20 }, botSeq),
  names: { [A]: 'Alpha', [B]: 'Beta' },
  buffNames: { [PROC]: 'proc_buff' },
} as unknown as BotRun;

/** O player: B gera o proc, depois mais um B com ele esperando, e só então A. */
function player() {
  const times = { a: [] as number[], b: [] as number[] };
  const trace: BuffTrace = { id: PROC, name: 'Proc Buff', maxStacks: 1, gains: 0, spans: [], drops: [] };
  for (let t = 2000; t + 3000 < 120_000; t += 4500) {
    times.b.push(t, t + 1500);
    times.a.push(t + 3000);
    trace.gains++;
    trace.spans.push([t + 10, t + 3000]);
    trace.drops.push([t + 3000, A]);
  }
  return fx.player('Fulano', {
    name: 'Fulano-Azralon',
    casts: [
      { spellId: A, name: 'Alpha', times: times.a },
      { spellId: B, name: 'Beta', times: times.b },
    ],
    rotation: { ...rotation, buffs: [trace] },
  });
}

describe('botDecisions', () => {
  const me = { pull: fx.pull(0, 0, 120_000, { players: [player()] }), player: player() };

  it('aprende das lutas do robô quem gasta o proc e marca o cast que ele não faria', () => {
    const d = botDecisions(me, run, null)!;
    expect(d.ref.procs[PROC]?.consumers).toEqual([A]);
    expect(d.choices).toHaveLength(1);
    const c = d.choices[0];
    expect([c.buff, c.spell.spellId, c.bot.spellId]).toEqual([PROC, B, A]);
    expect(c.botShare).toBe(1);
    expect(c.times.length).toBeGreaterThan(20);
    // o "castou outra coisa com o proc esperando" do mesmo proc não se repete
    expect(d.findings.filter((f) => f.kind === 'proc_wait')).toEqual([]);
  });

  it('avisa quando os tops fazem como o player', () => {
    const tops: DecisionRef = { n: 30, procs: { [PROC]: { name: 'Proc Buff', consumers: [B], consumerNames: ['Beta'], lost: { med: 0, p90: 0 }, wait: null } }, cds: {} };
    const d = botDecisions(me, run, tops)!;
    expect(Object.values(d.topsNotes)).toEqual([{ kind: 'agree_you', spell: 'Beta' }]);
    expect(d.topsDiffs).toEqual([{ kind: 'consumers', buff: PROC, name: 'Proc Buff', bot: ['Alpha'], tops: ['Beta'] }]);
  });

  it('sem leitura de rotação da spec, não compara', () => {
    expect(botDecisions({ ...me, player: { ...me.player, rotation: undefined } }, run, null)).toBeNull();
  });
});
