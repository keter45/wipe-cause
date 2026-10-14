import { describe, expect, it } from 'vitest';
import type { Death, Pull } from '../types';
import { decisiveDeaths, wipeCause } from './verdict';

const death = (name: string, t: number) => ({ name, guid: name, t }) as Death;

describe('decisiveDeaths', () => {
  it('mantém a morte isolada do início e as 2 primeiras da cascata', () => {
    // pull 12 do log real: tank morre aos 0:48; mortes espaçadas aos 5:08 e 5:26;
    // a cascata (4 mortes em 20s) só começa aos 5:46
    const ds = [death('tank', 48_000), ...[308, 326, 346, 346, 352, 358].map((s, i) => death(`p${i}`, s * 1000))];
    expect(decisiveDeaths(ds, 4).map((d) => d.name)).toEqual(['tank', 'p0', 'p1', 'p2', 'p3']);
  });

  it('sem cascata, usa as primeiras mortes', () => {
    const ds = [death('a', 10_000), death('b', 60_000), death('c', 120_000)];
    expect(decisiveDeaths(ds, 4).map((d) => d.name)).toEqual(['a', 'b', 'c']);
  });

  it('cascata logo no início = 2 primeiras mortes', () => {
    const ds = [0, 1, 2, 3, 4].map((s, i) => death(`p${i}`, 200_000 + s * 1000));
    expect(decisiveDeaths(ds, 4).map((d) => d.name)).toEqual(['p0', 'p1']);
  });
});

describe('wipeCause', () => {
  const pull = (deaths: number, trigger: Pull['trigger'], success = false) =>
    ({ success, trigger, deaths: Array.from({ length: deaths }, (_, i) => ({ ...death(`p${i}`, i * 1000), ignored: false })) }) as Pull;
  const trig = (n: number) => ({ key: 'orb', name: 'Orb', t: 1000, deaths: n });
  it('o gatilho com 2+ mortes ligadas, ou a única morte', () => {
    expect(wipeCause(pull(8, trig(5)))?.key).toBe('orb');
    expect(wipeCause(pull(1, trig(1)))?.key).toBe('orb');
  });
  it('mortes separadas sem causa comum, kill ou sem gatilho: nada', () => {
    expect(wipeCause(pull(14, trig(1)))).toBeNull();
    expect(wipeCause(pull(3, trig(5), true))).toBeNull();
    expect(wipeCause(pull(3, null))).toBeNull();
  });
});
