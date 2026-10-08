// Leitura dos fights baixados do Warcraft Logs (report.json + fight-<id>.json, o formato do
// scripts/wcl-fetch.mjs e do `rotation.mjs tops`): o que os players da spec castam, os buffs neles,
// os debuffs que eles põem nos inimigos e o recurso que ganham.

import fs from 'node:fs';
import path from 'node:path';

const bump = (map, id, name, n = 1) => {
  const e = (map[id] ??= { name, count: 0 });
  e.count += n;
};

/** Agrega os players da spec (pelo combatantinfo) em todas as pastas. */
export function readLogs(dirs, spec) {
  const out = { players: [], casts: {}, auras: {}, debuffs: {}, energize: {}, totalMs: 0 };
  for (const dir of dirs) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    const ability = new Map(report.masterData.abilities.map((a) => [a.gameID, a.name]));
    const name = (id) => ability.get(id) ?? `#${id}`;
    const actors = report.masterData.actors;
    for (const file of fs.readdirSync(dir).filter((f) => /^fight-\d+\.json$/.test(f))) {
      const fightId = +file.match(/\d+/)[0];
      const fight = report.fights.find((f) => f.id === fightId);
      if (!fight || fight.encounterID <= 0) continue;
      const events = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const mine = new Set(events.filter((e) => e.type === 'combatantinfo' && e.specID === spec.id).map((e) => e.sourceID));
      if (!mine.size) continue;
      const owner = new Map(actors.filter((a) => a.petOwner != null && mine.has(a.petOwner)).map((a) => [a.id, a.petOwner]));
      const per = new Map([...mine].map((id) => [id, { dir, fight: fightId, encounter: fight.encounterID, kill: fight.kill, actor: id, name: actors.find((a) => a.id === id)?.name, fightMs: fight.endTime - fight.startTime, casts: [], auras: new Set() }]));
      for (const e of events) {
        const src = e.sourceID;
        const me = per.get(src);
        if (e.type === 'cast' && me) {
          bump(out.casts, e.abilityGameID, name(e.abilityGameID));
          me.casts.push([e.timestamp - fight.startTime, e.abilityGameID]);
        } else if ((e.type === 'applybuff' || e.type === 'applybuffstack') && per.has(e.targetID)) {
          bump(out.auras, e.abilityGameID, name(e.abilityGameID));
          per.get(e.targetID).auras.add(e.abilityGameID);
        } else if (e.type === 'applydebuff' && (mine.has(src) || mine.has(owner.get(src))) && !mine.has(e.targetID)) {
          bump(out.debuffs, e.abilityGameID, name(e.abilityGameID));
        } else if (e.type === 'resourcechange' && per.has(e.targetID)) {
          const t = (out.energize[e.resourceChangeType] ??= { gain: 0, waste: 0, sources: {} });
          const waste = e.waste ?? 0;
          t.gain += Math.max(0, (e.resourceChange ?? 0) - waste);
          t.waste += waste;
          bump(t.sources, e.abilityGameID, name(e.abilityGameID), e.resourceChange ?? 0);
          (t.waste_by ??= {})[e.abilityGameID] = (t.waste_by[e.abilityGameID] ?? 0) + waste;
        }
      }
      for (const p of per.values()) {
        out.players.push(p);
        out.totalMs += p.fightMs;
      }
    }
  }
  return out;
}

/**
 * Nomes em inglês pelo id (dump do SimC): o Warcraft Logs grava os nomes no idioma do cliente de
 * quem subiu o log (russo, chinês...), e o gerador casa buffs e textos pelo nome.
 */
export function englishNames(logs, dump) {
  const fix = (map) => {
    for (const [id, e] of Object.entries(map ?? {})) {
      const en = dump.byId.get(+id)?.name;
      if (en) e.name = en;
    }
  };
  fix(logs.casts);
  fix(logs.auras);
  fix(logs.debuffs);
  for (const t of Object.values(logs.energize ?? {})) fix(t.sources);
  return logs;
}

/** Ids cast que repetem outro de mesmo nome no mesmo instante (ex.: The Hunt 370965 + 370966). */
export function echoIds(logs) {
  const byName = new Map();
  for (const [id, c] of Object.entries(logs.casts)) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(+id);
  }
  const echoes = new Set();
  for (const ids of byName.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => logs.casts[b].count - logs.casts[a].count);
    const main = ids[0];
    for (const other of ids.slice(1)) {
      let same = 0;
      let total = 0;
      for (const p of logs.players) {
        const at = p.casts.filter(([, id]) => id === main).map(([t]) => t);
        for (const [t, id] of p.casts) {
          if (id !== other) continue;
          total++;
          if (at.some((x) => Math.abs(x - t) <= 50)) same++;
        }
      }
      if (total && same / total >= 0.8) echoes.add(other);
    }
  }
  return echoes;
}
