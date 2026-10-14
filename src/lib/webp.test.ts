import { describe, expect, it } from 'vitest';
import { imageChunks, muxWebpAnimation } from './webp';

/** WebP de um quadro "falso" (o conteúdo VP8 não importa para o contêiner). */
function still(payload: number[], extra: [string, number[]][] = []): Uint8Array {
  const parts: number[] = [];
  const add = (type: string, data: number[]) => {
    parts.push(...[...type].map((c) => c.charCodeAt(0)), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data);
    if (data.length & 1) parts.push(0);
  };
  for (const [t, d] of extra) add(t, d);
  add('VP8 ', payload);
  const body = [...'WEBP'].map((c) => c.charCodeAt(0)).concat(parts);
  return Uint8Array.from([...[...'RIFF'].map((c) => c.charCodeAt(0)), body.length & 255, (body.length >> 8) & 255, 0, 0, ...body]);
}

/** Lê os chunks de primeiro nível (e os de dentro de cada ANMF). */
function parse(b: Uint8Array) {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const size = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  const out: { type: string; at: number; size: number }[] = [];
  for (let o = 12; o + 8 <= b.length; ) {
    out.push({ type: tag(o), at: o + 8, size: size(o + 4) });
    o += 8 + size(o + 4) + (size(o + 4) & 1);
  }
  return { riff: tag(0), riffSize: size(4), webp: tag(8), chunks: out, tag, size };
}

describe('WebP animado', () => {
  it('VP8X com a flag de animação, ANIM repetindo para sempre e um ANMF por quadro', () => {
    const frames = [
      { webp: still([1, 2, 3]), delayMs: 125 },
      { webp: still([4, 5, 6, 7]), delayMs: 900 },
    ];
    const out = muxWebpAnimation(640, 421, frames);
    const p = parse(out);
    expect([p.riff, p.webp, p.riffSize]).toEqual(['RIFF', 'WEBP', out.length - 8]);
    expect(p.chunks.map((c) => c.type)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF']);
    const vp8x = p.chunks[0].at;
    expect(out[vp8x] & 0x02).toBe(0x02);
    expect([out[vp8x + 4] | (out[vp8x + 5] << 8), out[vp8x + 7] | (out[vp8x + 8] << 8)]).toEqual([639, 420]);
    const anim = p.chunks[1].at;
    expect([out[anim + 4], out[anim + 5]]).toEqual([0, 0]);
    // cada ANMF: tamanho do quadro, duração em ms e o VP8 do quadro dentro
    const second = p.chunks[3].at;
    expect(out[second + 12] | (out[second + 13] << 8)).toBe(900);
    expect(out[second + 15]).toBe(0b10);
    expect(p.tag(second + 16)).toBe('VP8 ');
    expect([...out.subarray(second + 24, second + 28)]).toEqual([4, 5, 6, 7]);
  });

  it('do quadro, só a imagem (e a transparência); o resto fica de fora', () => {
    const img = imageChunks(still([9, 9, 9], [['ALPH', [1, 1]], ['EXIF', [0, 0, 0, 0]]]));
    expect(img.alpha).toBe(true);
    const tags = [];
    for (let o = 0; o < img.chunks.length; ) {
      tags.push(String.fromCharCode(...img.chunks.subarray(o, o + 4)));
      const s = img.chunks[o + 4] | (img.chunks[o + 5] << 8);
      o += 8 + s + (s & 1);
    }
    expect(tags).toEqual(['ALPH', 'VP8 ']);
    expect(() => imageChunks(new Uint8Array(20))).toThrow();
  });
});
