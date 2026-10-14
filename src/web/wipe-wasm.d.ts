// Tipos do núcleo em WASM (gerado por `npm run wasm` em src/web/pkg, fora do git). Ficam
// escritos aqui para o typecheck do app não depender do build do WASM.

declare module 'wipe-wasm/wipe_wasm.js' {
  export default function init(opts?: { module_or_path?: string | URL }): Promise<unknown>;
  export function setEnglish(en: boolean): void;
  export function analyzeFile(name: string, size: number, read: (pos: number, len: number) => Uint8Array, progress: (done: number, total: number) => void, deathCutoff: number, tunings: string): string;
  export function fightReplay(name: string, size: number, read: (pos: number, len: number) => Uint8Array, offset: number, tunings: string): string;
  export function rulesBase(encounterId: number): string;
  export function checkTuning(tuning: string): void;
  export class WclSession {
    constructor(deathCutoff: number, tzHours: number, tunings: string);
    addReport(report: string): void;
    fights(): string;
    beginFight(report: number, fightId: number): void;
    pushPage(events: string): string;
    pushSlim(events: string): void;
    finish(file: string): string;
    free(): void;
  }
}
