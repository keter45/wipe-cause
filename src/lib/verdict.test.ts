import { describe, expect, it } from 'vitest';
import type { Death } from '../types';
import { decisiveDeaths } from './verdict';

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
