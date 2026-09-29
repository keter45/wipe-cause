// Simula uma raid para testar o modo ao vivo: copia pulls de um log real, aos poucos, para um
// WoWCombatLog novo na pasta de logs (como o WoW faz durante a raid).
//
//   node scripts/simulate-live.mjs <log de origem> <pasta Logs> [pulls=3] [segundos por pull=8]
//
// Com o app aberto e "Ao vivo" ligado, cada pull copiado deve aparecer sozinho ao terminar.
// Apague o arquivo WoWCombatLog-999999_000000.txt gerado quando acabar.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [, , source, logsDir, pullsArg = '3', secsArg = '8'] = process.argv;
if (!source || !logsDir) {
  console.error('uso: node scripts/simulate-live.mjs <log de origem> <pasta Logs> [pulls] [segundos por pull]');
  process.exit(2);
}
const wantPulls = Number(pullsArg);
const secsPerPull = Number(secsArg);
const target = path.join(logsDir, 'WoWCombatLog-999999_000000.txt');

// junta o cabeçalho e os primeiros N encontros (ENCOUNTER_START..END) do log de origem
const header = [];
const pulls = [];
let current = null;
const rl = readline.createInterface({ input: fs.createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  const ev = line.slice(line.indexOf('  ') + 2);
  if (!pulls.length && !current && ev.startsWith('COMBAT_LOG_VERSION')) header.push(line);
  if (ev.startsWith('ENCOUNTER_START')) current = [line];
  else if (current) {
    current.push(line);
    if (ev.startsWith('ENCOUNTER_END')) {
      // ENCOUNTER_END,id,"nome",dif,tamanho,sucesso,duração(ms): o app ignora wipes de menos de 30s
      const f = ev.split(',');
      const short = f[5] !== '1' && Number(f[6]) < 30_000;
      if (!short) pulls.push(current);
      current = null;
      if (pulls.length >= wantPulls) break;
    }
  }
}
rl.close();
if (!pulls.length) {
  console.error('nenhum encontro completo no log de origem');
  process.exit(1);
}

fs.writeFileSync(target, header.map((l) => l + '\n').join(''));
console.log(`escrevendo ${pulls.length} pull(s) em ${target}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [i, lines] of pulls.entries()) {
  const name = lines[0].split(',')[2];
  console.log(`pull ${i + 1}: ${name} (${lines.length} linhas)`);
  // em ~secsPerPull segundos, em 20 blocos (o WoW também grava em blocos)
  const chunk = Math.ceil(lines.length / 20);
  for (let j = 0; j < lines.length; j += chunk) {
    fs.appendFileSync(target, lines.slice(j, j + chunk).map((l) => l + '\n').join(''));
    await sleep((secsPerPull * 1000) / 20);
  }
  console.log('  fim do pull — o app deve analisar em alguns segundos');
  await sleep(8000);
}
console.log('pronto. Apague o arquivo simulado quando terminar:', target);
