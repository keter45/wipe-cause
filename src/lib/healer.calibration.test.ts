// Calibração da comparação de healer (mesma ideia dos tops dos DPS): cada log de referência contra os
// outros do mesmo boss, escolhidos pela mesma regra. O que dois bons healers fazem diferente é estilo,
// não erro: quase nenhum log de referência deveria ganhar dica.
import { describe, expect, it } from 'vitest';
import { allHealRefs, healTips, MIN_REFS, pickRefs } from './healer';

describe('calibração da comparação de healer', () => {
  for (const spec of allHealRefs()) {
    it(`${spec.name}: logs de referência quase sem dica entre si`, () => {
      let n = 0;
      let withTip = 0;
      const byKind: Record<string, number> = {};
      for (const list of Object.values(spec.bosses)) {
        for (const you of list) {
          const self = you.healers.find((h) => h === spec.name) ?? spec.name;
          const { entries } = pickRefs(
            list.filter((e) => e !== you),
            you.healers,
            self,
            you.durationMs,
          );
          if (entries.length < MIN_REFS) continue;
          n++;
          const tips = healTips(you, entries, {
            kindOf: new Map(Object.entries(spec.kinds ?? {})),
            timesOf: new Map(),
            checkedAlly: new Set(spec.checkedAlly ?? []),
            manaTimeline: [],
            success: true,
            nameOf: (id) => spec.names[id] ?? String(id),
          });
          if (tips.length) withTip++;
          for (const t of tips) {
            const k =
              t.kind === 'check'
                ? `check:${t.checkId}`
                : t.kind === 'cooldown' || t.kind === 'overheal' || t.kind === 'ally'
                  ? `${t.kind}:${t.name}`
                  : t.kind;
            byKind[k] = (byKind[k] ?? 0) + 1;
          }
        }
      }
      console.log(`${spec.name}: ${withTip}/${n} logs de referência com dica`, byKind);
      if (n) expect(withTip / n).toBeLessThanOrEqual(0.35);
    });
  }
});
