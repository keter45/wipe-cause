// Bytes <-> base64, num lugar só (cartões, clipes, arquivos salvos, Discord no site, login do WCL).

/** Bytes em base64 (em pedaços: um clipe tem alguns MB e o spread estoura a pilha). */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Texto (UTF-8) em base64. */
export const utf8ToB64 = (text: string) => bytesToB64(new TextEncoder().encode(text));

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** base64 de uma data URL ("data:image/png;base64,..."). */
export const dataUrlB64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** base64url sem "=" (PKCE do OAuth). */
export const b64url = (bytes: Uint8Array) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
