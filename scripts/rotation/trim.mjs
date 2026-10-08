// Deixa num fight baixado só os eventos que a leitura da rotação usa: o que os players do ranking (e
// os pets deles) fazem, o que cai neles, as mortes, o dano de um colega e os casts dos inimigos (para
// alinhar os pulls pelas mecânicas do boss). Serve de rede de
// segurança no download dos tops (a API às vezes ignora o filtro por ator e devolve a luta inteira).

/** Nome ou reino comparável: o ranking escreve "Tarren Mill" e o report "TarrenMill". */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s'’-]/g, '');

/** Atores do fight: os players do ranking, os pets deles, um colega de referência (um basta) e os inimigos. */
export function fightActors(report, fightId, names) {
  const fight = report.fights.find((f) => f.id === +fightId);
  const actors = report.masterData.actors;
  const same = (n, a) => norm(n.name) === norm(a.name) && (!n.server || !a.server || norm(n.server) === norm(a.server));
  const targets = actors.filter((a) => a.type === 'Player' && names.some((n) => same(n, a))).map((a) => a.id);
  const pets = actors.filter((a) => targets.includes(a.petOwner)).map((a) => a.id);
  const refs = (fight?.friendlyPlayers ?? []).filter((id) => !targets.includes(id)).slice(0, 1);
  const enemies = actors.filter((a) => a.type === 'NPC').map((a) => a.id);
  return { fight, targets, pets, refs, enemies };
}

export function trimEvents(events, { targets, pets, refs, enemies = [] }) {
  const mine = new Set([...targets, ...pets]);
  const enemy = new Set(enemies);
  const hit = new Set(targets);
  const ref = new Set(refs);
  return events.filter(
    (e) =>
      (mine.has(e.sourceID) && e.type !== 'damage') ||
      (hit.has(e.targetID) && !['damage', 'absorbed', 'heal'].includes(e.type)) ||
      e.type === 'death' ||
      e.type === 'encounterstart' ||
      e.type === 'encounterend' ||
      (e.type === 'damage' && ref.has(e.sourceID)) ||
      ((e.type === 'cast' || e.type === 'begincast') && enemy.has(e.sourceID)),
  );
}
