// `tauri build` assinado para a atualização automática. A chave privada fica fora do repo,
// em ~/.tauri/wipe-cause.key (ou em TAURI_SIGNING_PRIVATE_KEY, se já definida).

import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const key = path.join(os.homedir(), '.tauri', 'wipe-cause.key');
  if (!fs.existsSync(key)) throw new Error(`chave de assinatura não encontrada: ${key}`);
  env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(key, 'utf8');
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
execSync('npx tauri build', { stdio: 'inherit', env });
