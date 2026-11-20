import { describe, expect, it } from 'vitest';
import { fitStatus, mergeFits, posAt, shapeFit } from './shapeFit.mjs';

// pull sintético: passo de 100 ms, cada player parado num lugar o pull todo (décimos de jarda)
const STEP = 100;
function pullWith(places, extra) {
  const players = places.map((_, i) => `Player-1-${i}`);
  const n = 400; // 40 s
  const units = places.map(([x, y], i) => ({ guid: players[i], name: `p${i}`, kind: 'player', segs: [{ t0: 0, xy: Array.from({ length: n }, () => [x * 10, y * 10]).flat() }] }));
  return { tracks: { stepMs: STEP, units: [...units, ...(extra?.units ?? [])] }, fight: { players, hp: places.map(() => [[0, 100]]), auras: extra?.auras ?? [], events: extra?.events ?? [] }, ...extra?.views };
}
const dmg = (t, pi, spell) => [t, 0, pi, spell, 1000, 0];

describe('posAt', () => {
  it('interpola entre dois passos e devolve null fora dos trechos', () => {
    const tr = { segs: [{ t0: 1000, xy: [0, 0, 100, 0] }] };
    expect(posAt(tr, 1050, 100)).toEqual([5, 0]);
    expect(posAt(tr, 900, 100)).toBeNull();
  });
});

describe('shapeFit', () => {
  const rule = { mechanics: [{ key: 'froth', detect: { damage_ids: [7] } }, { key: 'pool', detect: { damage_ids: [8] } }, { key: 'smash', detect: { damage_ids: [9] }, cone: { cast_id: 90 } }] };

  it('área no portador: quem tomou está dentro do raio, quem não tomou está fora', () => {
    // portador no 0 (aura 70), atingidos a 3 jd, não atingidos a 10 jd
    const places = [[0, 0], [3, 0], [0, 3], [10, 0], [0, 10]];
    const events = [1000, 2000, 3000].flatMap((t) => [dmg(t, 1, 7), dmg(t, 2, 7)]);
    const pull = pullWith(places, { auras: [[0, 70, 0, 30000, 1, 1]], events, views: { areas: [{ key: 'froth', name: 'Froth', spellId: 7, aura: 70, radius: 5 }] } });
    const f = mergeFits([shapeFit(pull, rule)]).froth;
    expect(f.hits).toBe(6);
    expect(f.tpr).toBe(1);
    expect(f.nonHit).toBe(6);
    expect(f.fpr).toBe(0);
  });

  it('área pequena demais: acertos fora do raio derrubam o TPR', () => {
    const places = [[0, 0], [8, 0], [0, 8]];
    const events = Array.from({ length: 12 }, (_, k) => [dmg(1000 * (k + 1), 1, 7), dmg(1000 * (k + 1), 2, 7)]).flat();
    const pull = pullWith(places, { auras: [[0, 70, 0, 30000, 1, 1]], events, views: { areas: [{ key: 'froth', name: 'Froth', spellId: 7, aura: 70, radius: 5 }] } });
    const f = mergeFits([shapeFit(pull, rule)]).froth;
    expect(f.tpr).toBe(0);
    expect(fitStatus(f)).toBe('REVISAR');
  });

  it('poça: amostras de 1 s dentro e fora do círculo', () => {
    const places = [[0, 0], [20, 0]];
    const events = Array.from({ length: 10 }, (_, k) => dmg(5000 + 1000 * k + 100, 0, 8));
    const pull = pullWith(places, { events, views: { pools: [{ key: 'pool', name: 'Pool', spellId: 8, from: 4000, on: 5000, to: 15000, growMs: 0, circles: [[0, 0, 6]] }] } });
    const f = mergeFits([shapeFit(pull, rule)]).pool;
    expect(f.hits).toBe(10);
    expect(f.inside).toBe(10);
    expect(f.nonHit).toBe(10);
    expect(f.nonHitInside).toBe(0);
  });

  it('cone: na frente de quem lança, pelo facing', () => {
    // boss no 0 olhando para +x; atingido em (10, 0), fora do cone em (-10, 0)
    const boss = { guid: 'Creature-0-1-2-3-500-1', name: 'Boss', kind: 'enemy', segs: [{ t0: 0, xy: Array.from({ length: 400 }, () => [0, 0]).flat() }] };
    const pull = pullWith([[10, 0], [-10, 0]], { units: [boss], events: [dmg(5100, 0, 9)], views: { casts: [{ t: 3000, end: 5000, guid: boss.guid, spellId: 90, name: 'Smash', facing: 0, cone: { halfAngle: 30, range: 20 } }] } });
    const f = mergeFits([shapeFit(pull, rule)]).smash;
    expect(f.shape).toBe('cone');
    expect(f.tpr).toBe(1);
    expect(f.nonHit).toBe(1);
    expect(f.fpr).toBe(0);
  });

  it('vários círculos no mesmo instante: o soaker de um círculo não conta como fora do outro', () => {
    const places = [[0, 0], [30, 0], [60, 0]];
    const events = [dmg(5000, 0, 9), dmg(5040, 1, 9)];
    const caster = 'Creature-0-1-2-3-500-1';
    const soaks = [[0, 0], [30, 0]].map(([x, y]) => ({ key: 'smash', name: 'S', spellId: 9, from: 4000, at: 5000, x, y, radius: 4, hit: 1, caster }));
    const f = mergeFits([shapeFit(pullWith(places, { events, views: { soaks } }), rule)]).smash;
    expect(f.hits).toBe(2);
    expect(f.tpr).toBe(1);
    expect(f.derived).toBe(false);
  });

  it('soak sem lançador fica marcado como derivado (o centro vem de quem tomou)', () => {
    const pull = pullWith([[0, 0]], { events: [dmg(5000, 0, 9)], views: { soaks: [{ key: 'smash', name: 'S', spellId: 9, from: 4000, at: 5000, x: 0, y: 0, radius: 5, hit: 1 }] } });
    expect(shapeFit(pull, rule).smash.derived).toBe(true);
  });
});
