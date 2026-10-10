// Baixa os tops de várias specs em sequência, respeitando o limite de pontos por hora da API do
// Warcraft Logs: antes de cada spec confere os pontos e, se estiverem acabando, espera o limite
// zerar e continua. Rode uma vez e deixe; o que já foi baixado é pulado.
//
//   node scripts/rotation/tops-all.mjs [--per-boss 4] [--zone <id>|latest] [spec1 spec2 ...]
//
// --zone: chefes de outra zona do Warcraft Logs ("latest" = o raide mais novo); sem ela, os do raide
// que já tem regras em encounters/.
//
// Sem specs, segue a lista padrão: primeiro as specs da raid que foram calibradas nos players da
// guild (pela quantidade de players na última raid), depois as outras da raid, as que sobraram do
// app e, por último, as que ninguém da raid joga.

import path from 'node:path';
import { findSpec } from './specs.mjs';
import { clientCount, downloadTops, probeClient, useClient } from './tops.mjs';

const ROOT = path.join(import.meta.dirname, '..', '..');
const DEFAULT = [
  // na raid de 06/10, calibradas nos players da guild
  'mage-arcane', 'warlock-destruction', 'warrior-arms', 'demonhunter-havoc', 'warlock-demonology', 'paladin-retribution',
  'hunter-marksmanship', 'shaman-elemental', 'druid-balance', 'rogue-assassination', 'demonhunter-devourer', 'priest-shadow',
  'deathknight-unholy', 'warlock-affliction',
  // na raid, geradas com poucos tops
  'mage-fire', 'mage-frost',
  // no app, ninguém da raid joga hoje
  'evoker-devastation', 'hunter-beast-mastery',
  // geradas, ninguém da raid joga hoje
  'druid-feral', 'shaman-enhancement',
];
/** Pontos que uma spec costuma gastar com 4 por boss (medido no Augmentation: ~140 a ~840). */
const BUDGET = 600;
const MAX_TRIES = 3;

const args = process.argv.slice(2);
const i = args.indexOf('--per-boss');
const perBoss = i >= 0 ? +args[i + 1] : 4;
const z = args.indexOf('--zone');
const zone = z >= 0 ? args[z + 1] : undefined;
const specs = args.filter((a, k) => !a.startsWith('--') && k !== i + 1 && k !== z + 1);
const list = specs.length ? specs : DEFAULT;

const clock = () => new Date().toLocaleTimeString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let gql = await probeClient();
let current = 0;
/** Pontos da API; se a própria consulta falhar (queda, limite estourado), espera 5 min e tenta de novo. */
async function rate() {
  for (;;) {
    try {
      return (await gql('{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }')).rateLimitData;
    } catch (e) {
      console.log(`[${clock()}] não deu para ler os pontos da API (${e.message.slice(0, 80)}): tentando de novo em 5 min…`);
      await sleep(5 * 60_000);
    }
  }
}

/**
 * Espera o limite zerar se sobrar menos que `need` pontos nesta hora; com mais de um cliente no
 * arquivo de testes, antes tenta os outros.
 */
async function waitFor(need) {
  let r = await rate();
  let left = r.limitPerHour - r.pointsSpentThisHour;
  for (let k = 1; left < need && k < clientCount(); k++) {
    current = (current + 1) % clientCount();
    useClient(current);
    gql = await probeClient();
    r = await rate();
    left = r.limitPerHour - r.pointsSpentThisHour;
    console.log(`[${clock()}] trocando para o cliente ${current + 1} do arquivo de testes (${Math.round(left)} pontos)`);
  }
  if (left >= need) return;
  const s = (r.pointsResetIn ?? 3600) + 15;
  console.log(`[${clock()}] ${Math.round(left)} pontos sobrando: esperando o limite zerar (${Math.ceil(s / 60)} min)…`);
  await sleep(s * 1000);
}

for (const [n, key] of list.entries()) {
  const spec = findSpec(key);
  const out = path.join(ROOT, 'samples', 'rotation', spec.file, 'tops');
  for (let tries = 1; tries <= MAX_TRIES; tries++) {
    await waitFor(BUDGET);
    console.log(`\n[${clock()}] (${n + 1}/${list.length}) ${spec.name}`);
    try {
      await downloadTops(spec, out, { perBoss, zone });
      break;
    } catch (e) {
      console.log(`[${clock()}] ${spec.name}: ${e.message}`);
      if (tries === MAX_TRIES) console.log(`[${clock()}] ${spec.name}: desistindo depois de ${MAX_TRIES} tentativas, seguindo para a próxima`);
      else await waitFor(BUDGET); // se foi o limite, espera zerar; se não, tenta de novo na hora
    }
  }
}
console.log(`\n[${clock()}] pronto: ${list.length} specs`);
