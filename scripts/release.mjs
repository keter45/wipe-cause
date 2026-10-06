// Prepara os arquivos de uma release com atualização automática.
//
//   npm run release:build            # tauri build assinado (chave em ~/.tauri/wipe-cause.key)
//   node scripts/release.mjs notas.md   # seções "## Português" e "## English"
//
// Gera em target/release/upload/:
//   WipeCause_<versão>_x64-setup.exe   instalador (nome sem espaço: vira a URL do asset)
//   latest.json                        o que o app instalado consulta para se atualizar
// e imprime o comando `gh release create` que publica os dois.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const version = conf.version;
const repo = 'keter45/wipe-cause';

const nsis = path.join(root, 'target/release/bundle/nsis');
const exe = fs.readdirSync(nsis).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
if (!exe) throw new Error(`instalador da versão ${version} não encontrado em ${nsis}: rode npm run release:build`);
const sigPath = path.join(nsis, `${exe}.sig`);
if (!fs.existsSync(sigPath)) throw new Error(`${exe}.sig não existe: o build não foi assinado (TAURI_SIGNING_PRIVATE_KEY)`);

const out = path.join(root, 'target/release/upload');
fs.mkdirSync(out, { recursive: true });
const asset = `WipeCause_${version}_x64-setup.exe`;
fs.copyFileSync(path.join(nsis, exe), path.join(out, asset));

// notas nas duas línguas: uma seção "## Português" e uma "## English" (o app mostra a do idioma
// escolhido; o GitHub, as duas)
const notesFile = process.argv[2];
if (!notesFile) throw new Error('falta o arquivo de notas (com as seções "## Português" e "## English")');
const notes = fs.readFileSync(notesFile, 'utf8').trim();
for (const h of ['## Português', '## English']) {
  if (!notes.split(/\r?\n/).some((l) => l.trim() === h)) throw new Error(`as notas precisam da seção "${h}": o app é sempre nas duas línguas`);
}
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sigPath, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${asset}`,
    },
  },
};
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');

console.log(`pronto em ${path.relative(root, out)}:`);
console.log(`  ${asset}`);
console.log('  latest.json');
console.log('\npublicar:');
console.log(
  `  gh release create v${version} "${path.relative(root, path.join(out, asset))}" "${path.relative(root, path.join(out, 'latest.json'))}" --title "v${version}" --notes-file "${notesFile}"`,
);
