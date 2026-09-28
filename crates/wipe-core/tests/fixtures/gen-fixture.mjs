// Gera um WoWCombatLog sintético (formato v22 com advanced logging) para os testes.
// Uso: node crates/wipe-core/tests/fixtures/gen-fixture.mjs > crates/wipe-core/tests/fixtures/twin-fangs.txt
//
// Cenário (The Twin Fangs, Heroic):
//  pull 1 (wipe 2:30): tank usa Shield Wall; mage usa Ice Block; priest morre pro Vile Flood aos 1:30
//                      sem usar Desperate Prayer (que ele usa no pull 2 => "disponível").
//  pull 2 (wipe 1:00): priest usa Desperate Prayer; warrior usa healthstone; mage toma poção e morre
//                      pro Corrosive Spit aos 0:45 com Ice Block disponível.
//  pull 3 (kill 3:00)

const NIL = ['0000000000000000', 'nil', '0x80000000', '0x80000000'];
const mage = { guid: 'Player-3209-0A1B2C3D', name: 'Magozin-Azralon', flags: '0x514', maxHp: 800000 };
const priest = { guid: 'Player-3209-0A1B2C3E', name: 'Curandeira-Azralon', flags: '0x514', maxHp: 700000 };
const warrior = { guid: 'Player-3209-0A1B2C3F', name: 'Tankão-Gallywix', flags: '0x514', maxHp: 1500000 };
const pet = { guid: 'Pet-0-3767-2900-1111-165189-0100AABBCC', name: 'Pet do Mage', flags: '0x1114', maxHp: 300000 };
const vexhul = { guid: 'Creature-0-3767-2900-1111-257361-0000AAAAAA', name: 'Vexhul', flags: '0x10a48', maxHp: 100000000 };
const ithraz = { guid: 'Creature-0-3767-2900-1111-257368-0000BBBBBB', name: 'Ithraz', flags: '0x10a48', maxHp: 100000000 };
const spawn = { guid: 'Creature-0-3767-2900-1111-270000-0000CCCCCC', name: 'Spawn of Vexhul', flags: '0xa48', maxHp: 5000000 };

const hp = new Map();
const out = [];
let clock = Date.UTC(2026, 8, 28, 21, 0, 0);

function ts(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}0-3`;
}
const q = (s) => `"${s}"`;
const unit = (u) => (u ? [u.guid, q(u.name), u.flags, '0x0'] : NIL);
function adv(u, owner = '0000000000000000') {
  const cur = hp.has(u.guid) ? hp.get(u.guid) : u.maxHp;
  return [u.guid, owner, cur, u.maxHp, 0, 0, 5000, 0, 0, 100, 100, 0, '1234.50', '-567.80', 2900, '1.5708', 620];
}
function line(t, fields) {
  out.push({ t, text: `${ts(t)}  ${fields.join(',')}` });
}
function setHp(u, v) {
  hp.set(u.guid, Math.max(0, v));
}

function damage(t, src, dst, spellId, spellName, amount, { swing = false } = {}) {
  const cur = hp.has(dst.guid) ? hp.get(dst.guid) : dst.maxHp;
  const overkill = amount > cur ? amount - cur : -1;
  setHp(dst, cur - amount);
  const suffix = [amount, amount, overkill, 1, 0, 0, 0, 'nil', 'nil', 'nil'];
  if (swing) {
    line(t, ['SWING_DAMAGE', ...unit(src), ...unit(dst), ...adv(src), ...suffix]);
    line(t, ['SWING_DAMAGE_LANDED', ...unit(src), ...unit(dst), ...adv(dst), ...suffix]);
  } else {
    line(t, ['SPELL_DAMAGE', ...unit(src), ...unit(dst), spellId, q(spellName), '0x8', ...adv(dst), ...suffix, 'ST']);
  }
}
function heal(t, src, dst, spellId, spellName, amount, overheal = 0) {
  const cur = hp.has(dst.guid) ? hp.get(dst.guid) : dst.maxHp;
  setHp(dst, Math.min(dst.maxHp, cur + amount - overheal));
  line(t, ['SPELL_HEAL', ...unit(src), ...unit(dst), spellId, q(spellName), '0x2', ...adv(dst), amount, amount, overheal, 0, 'nil']);
}
function cast(t, src, spellId, spellName, owner) {
  line(t, ['SPELL_CAST_SUCCESS', ...unit(src), ...NIL, spellId, q(spellName), '0x1', ...adv(src, owner)]);
}
function died(t, u) {
  line(t, ['UNIT_DIED', ...NIL, ...unit(u), 0]);
}
function combatant(t, u, spec) {
  const stats = Array.from({ length: 21 }, (_, i) => 100 + i);
  line(t, ['COMBATANT_INFO', u.guid, 0, ...stats, spec, '[(1,2,1),(3,4,1)]', '(0,0,0,0)', '[(212345,639,(),(1,2),())]', `[${u.guid},1234,1]`, 0, 0, 0]);
}

function startPull(t) {
  for (const u of [mage, priest, warrior, pet, vexhul, ithraz, spawn]) hp.delete(u.guid);
  line(t, ['ENCOUNTER_START', 3180, q('The Twin Fangs'), 15, 20, 2900]);
  combatant(t, mage, 63);
  combatant(t, priest, 256);
  combatant(t, warrior, 73);
}
const s = (n) => n * 1000;

// ---------------- log ----------------
line(clock, ['COMBAT_LOG_VERSION', 22, 'ADVANCED_LOG_ENABLED', 1, 'BUILD_VERSION', '12.1.0', 'PROJECT_ID', 1]);
line(clock + 1000, ['ZONE_CHANGE', 2900, q('The Venomous Abyss'), 15]);
// trash fora de encontro (deve ser ignorado)
damage(clock + 2000, mage, spawn, 133, 'Fireball', 99999);

// ---- pull 1 ----
let p = Date.UTC(2026, 8, 28, 21, 5, 0);
startPull(p);
line(p + 500, ['SPELL_SUMMON', ...unit(mage), ...unit(pet), 88747, q('Summon Pet'), '0x1']);
for (let i = 1; i <= 140; i++) {
  damage(p + s(i), mage, vexhul, 133, 'Fireball', 150000);
  damage(p + s(i) + 200, pet, ithraz, 999001, 'Pet Bite', 50000);
  damage(p + s(i) + 300, vexhul, warrior, 1, 'Melee', 80000, { swing: true });
  heal(p + s(i) + 400, priest, warrior, 2061, 'Flash Heal', 90000, 10000);
}
cast(p + s(5), warrior, 871, 'Shield Wall');
cast(p + s(10), mage, 45438, 'Ice Block');
// priest morre pro Vile Flood aos 1:30
heal(p + s(84), priest, priest, 2061, 'Flash Heal', 50000, 50000);
damage(p + s(86), ithraz, priest, 1295049, 'Toxic Fumes', 100000);
damage(p + s(88), vexhul, priest, 1294293, 'Vile Flood', 350000);
damage(p + s(90), vexhul, priest, 1294293, 'Vile Flood', 400000);
died(p + s(90) + 10, priest);
line(p + s(150), ['ENCOUNTER_END', 3180, q('The Twin Fangs'), 15, 20, 0, 150000]);

// ---- pull 2 ----
p = Date.UTC(2026, 8, 28, 21, 10, 0);
startPull(p);
cast(p + s(3), priest, 19236, 'Desperate Prayer');
cast(p + s(20), warrior, 6262, 'Healthstone');
for (let i = 1; i <= 55; i++) damage(p + s(i), mage, vexhul, 133, 'Fireball', 150000);
damage(p + s(40), spawn, mage, 1291478, 'Corrosive Spit', 500000);
cast(p + s(41), mage, 431416, 'Algari Healing Potion');
heal(p + s(41), mage, mage, 431416, 'Algari Healing Potion', 200000, 0);
damage(p + s(44), spawn, mage, 1291478, 'Corrosive Spit', 300000);
damage(p + s(45), spawn, mage, 1291478, 'Corrosive Spit', 300000);
died(p + s(45) + 5, mage);
line(p + s(60), ['ENCOUNTER_END', 3180, q('The Twin Fangs'), 15, 20, 0, 60000]);

// ---- pull 3 (kill) ----
p = Date.UTC(2026, 8, 28, 21, 15, 0);
startPull(p);
for (let i = 1; i <= 179; i++) {
  damage(p + s(i), mage, vexhul, 133, 'Fireball', 560000);
  damage(p + s(i) + 100, mage, ithraz, 133, 'Fireball', 560000);
}
died(p + s(180), vexhul);
died(p + s(180), ithraz);
line(p + s(180), ['ENCOUNTER_END', 3180, q('The Twin Fangs'), 15, 20, 1, 180000]);

// cada linha termina em \r\n como no cliente Windows
// ordena por tempo (sort estável mantém a ordem de eventos no mesmo ms)
out.sort((a, b) => a.t - b.t);
process.stdout.write(out.map((l) => l.text).join('\r\n') + '\r\n');
