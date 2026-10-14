// Compila o núcleo (crates/wipe-wasm) para o navegador e gera os bindings em src/web/pkg,
// usados pela versão web. Precisa do alvo wasm32 e do wasm-bindgen-cli na mesma versão do
// crate (ver crates/wipe-wasm/Cargo.toml):
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version 0.2.129 --locked

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

run('cargo', ['build', '-p', 'wipe-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
run('wasm-bindgen', ['--target', 'web', '--out-dir', 'src/web/pkg', 'target/wasm32-unknown-unknown/release/wipe_wasm.wasm']);
