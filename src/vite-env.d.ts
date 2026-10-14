/// <reference types="vite/client" />

/** versão do package.json (o site mostra; o app usa a do Tauri) */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** "web" no build do site (npm run build:web); vazio no app */
  readonly VITE_TARGET?: string;
}
