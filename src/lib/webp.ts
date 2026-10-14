// WebP animado sem dependências: cada quadro é um WebP comum (o canvas do navegador codifica:
// `canvas.toBlob('image/webp')`), e aqui eles são juntados no contêiner de animação do WebP
// (RIFF: VP8X com a flag de animação, ANIM com a repetição e um ANMF por quadro).

export interface WebpFrame {
  /** um arquivo WebP de um quadro só (do tamanho da animação) */
  webp: Uint8Array;
  /** quanto o quadro fica na tela (ms) */
  delayMs: number;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

/** Um chunk RIFF (tipo de 4 letras, tamanho, conteúdo e o byte de preenchimento se for ímpar). */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1));
  out.set(ascii(type), 0);
  out.set(u32(payload.length), 4);
  out.set(payload, 8);
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Os chunks de imagem de um WebP de um quadro (VP8 / VP8L, e ALPH quando tem transparência). */
export function imageChunks(webp: Uint8Array): { chunks: Uint8Array; alpha: boolean } {
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw new Error('not a WebP');
  const keep: Uint8Array[] = [];
  let alpha = false;
  for (let o = 12; o + 8 <= webp.length; ) {
    const type = tag(o);
    const size = webp[o + 4] | (webp[o + 5] << 8) | (webp[o + 6] << 16) | (webp[o + 7] << 24);
    const end = o + 8 + size + (size & 1);
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ALPH') keep.push(webp.subarray(o, end));
    // sem perdas (VP8L) também pode ter transparência
    if (type === 'ALPH' || type === 'VP8L') alpha = true;
    o = end;
  }
  if (!keep.length) throw new Error('WebP without image data');
  return { chunks: concat(keep), alpha };
}

/** WebP animado com os quadros (todos do tamanho da animação), repetindo para sempre. */
export function muxWebpAnimation(width: number, height: number, frames: WebpFrame[]): Uint8Array {
  if (!frames.length) throw new Error('empty animation');
  let alpha = false;
  const anmf = frames.map((f) => {
    const img = imageChunks(f.webp);
    alpha = alpha || img.alpha;
    const head = new Uint8Array([
      ...u24(0), // x / 2
      ...u24(0), // y / 2
      ...u24(width - 1),
      ...u24(height - 1),
      ...u24(Math.max(1, Math.round(f.delayMs))),
      0b10, // sem mistura com o quadro anterior (cada quadro é a tela inteira), sem descarte
    ]);
    return chunk('ANMF', concat([head, img.chunks]));
  });
  // VP8X: animação (e transparência, se algum quadro tiver), tamanho da tela
  const vp8x = chunk('VP8X', new Uint8Array([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]));
  // ANIM: fundo (BGRA) e quantas vezes repete (0 = para sempre)
  const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 255, 0, 0]));
  const body = concat([ascii('WEBP'), vp8x, anim, ...anmf]);
  return concat([ascii('RIFF'), new Uint8Array(u32(body.length)), body]);
}
