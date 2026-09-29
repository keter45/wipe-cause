// Compartilhar sem o app: gera um cartão (PNG ou HTML) a partir de um componente React
// renderizado fora da tela, e copia, salva ou envia ao Discord.

import { createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './api';
import { EagerIcons } from '../components/SpellIcon';

/** Renderiza `node` fora da tela e devolve o elemento pronto (e como desmontar). */
async function mount(node: ReactElement): Promise<{ el: HTMLElement; done: () => void }> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(EagerIcons.Provider, { value: true }, node));
  // dois frames: o React monta e o navegador faz o layout
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const el = host.firstElementChild as HTMLElement;
  await iconsLoaded(el);
  return {
    el,
    done: () => {
      root.unmount();
      host.remove();
    },
  };
}

/**
 * Espera os ícones das habilidades: cada um busca o tooltip no Wowhead e depois a imagem.
 * Para quando nada novo aparece por alguns instantes (ou em até 5s).
 */
async function iconsLoaded(el: HTMLElement) {
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 50 && stable < 4; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const imgs = [...el.querySelectorAll('img')];
    const done = imgs.every((img) => img.complete);
    stable = done && imgs.length === last ? stable + 1 : 0;
    last = imgs.length;
  }
}

/** PNG (data URL) do cartão, em 2x para ficar nítido no Discord. */
export async function cardPng(node: ReactElement): Promise<string> {
  const { el, done } = await mount(node);
  try {
    return await toPng(el, { pixelRatio: 2, cacheBust: true });
  } finally {
    done();
  }
}

/** Página HTML sozinha (CSS do app embutido), para abrir em qualquer navegador. */
export async function cardHtml(node: ReactElement, title: string): Promise<string> {
  const { el, done } = await mount(node);
  try {
    const css = [...document.styleSheets]
      .map((ss) => {
        try {
          return [...ss.cssRules].map((r) => r.cssText).join('\n');
        } catch {
          return ''; // folha de outro domínio (fontes): fica de fora
        }
      })
      .join('\n');
    const esc = title.replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c]!);
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc}</title><style>${css}\nbody{display:flex;justify-content:center;padding:24px;}</style></head><body>${el.outerHTML}</body></html>`;
  } finally {
    done();
  }
}

/**
 * PDF: abre o diálogo de impressão do sistema com o cartão (escolher "Salvar como PDF"). O PDF
 * do Chromium/WebView2 mantém os links clicáveis e o texto selecionável.
 */
export async function printPdf(html: string): Promise<void> {
  // fundo escuro em toda a página, sem cortar seção de burst/tabela no meio da página
  const printCss = `<style>
@page { size: A4; margin: 0; }
html, body { background: #0f1115 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { display: block !important; padding: 10mm !important; margin: 0; }
.share-card { width: 100% !important; box-shadow: none !important; }
.perf-card-burst, .cd-row, tr, .perf-insights li { break-inside: avoid; }
h4 { break-after: avoid; }
</style>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = html.replace('</head>', `${printCss}</head>`);
  const loaded = new Promise((r) => (frame.onload = r));
  document.body.appendChild(frame);
  await loaded;
  const win = frame.contentWindow!;
  // ícones já estavam carregados no cartão; espera só o navegador do iframe pegar do cache
  await Promise.all([...win.document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', () => setTimeout(cleanup, 500));
  setTimeout(cleanup, 10 * 60_000); // se o afterprint não vier
  win.focus();
  win.print();
}

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);
const utf8b64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export async function copyPng(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Salvar: no app, diálogo do sistema; no navegador, download. */
async function saveFile(name: string, ext: 'png' | 'html', dataB64: string, mime: string): Promise<boolean> {
  if (!inTauri) {
    const a = document.createElement('a');
    a.href = `data:${mime};base64,${dataB64}`;
    a.download = name;
    a.click();
    return true;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return false;
  await invoke('save_file', { path, dataB64 });
  return true;
}

export const savePng = (dataUrl: string, name: string) => saveFile(name, 'png', b64(dataUrl), 'image/png');
export const saveHtml = (html: string, name: string) => saveFile(name, 'html', utf8b64(html), 'text/html');

/** Envia o PNG ao webhook configurado, como imagem de um embed. */
export async function sendPngToDiscord(dataUrl: string, fileName: string, title: string) {
  const payload = { username: 'Wipe Cause', embeds: [{ title, color: 0x3987e5, image: { url: `attachment://${fileName}` } }] };
  await invoke('discord_post_image', { payload, fileName, dataB64: b64(dataUrl), webhook: null });
}

/** Nome de arquivo sem acentos/espaços: "pull-12-the-coiled-altar". */
export const fileSlug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
