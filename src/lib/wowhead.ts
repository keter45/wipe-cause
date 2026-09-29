// Nome, ícone e descrição de spells (e itens): o combat log não traz nada disso além do nome
// (ou só o ID, no caso dos itens), então buscamos no endpoint público de tooltips do Wowhead
// e guardamos no localStorage.

import { useEffect, useState } from 'react';

export interface SpellTooltip {
  name: string;
  icon: string | null;
  /** texto da descrição, sem HTML */
  text: string;
  /** itens: 0 cinza … 4 épico, 5 lendário */
  quality?: number;
}

export type TooltipKind = 'spell' | 'item';
/** Spells guardados só pelo número (cache antigo); itens com prefixo. */
const keyOf = (id: number, kind: TooltipKind) => (kind === 'spell' ? String(id) : `item:${id}`);

const CACHE_KEY = 'wipe-cause:wowhead:';
/** buscas simultâneas no Wowhead (um recap tem dezenas de spells) */
const MAX_CONCURRENT = 4;

const memory = new Map<string, SpellTooltip | null>();
const inflight = new Map<string, Promise<SpellTooltip | null>>();
const queue: (() => void)[] = [];
let running = 0;

export function wowheadUrl(id: number, kind: TooltipKind = 'spell'): string {
  return `https://www.wowhead.com/${kind}=${id}`;
}

/** `medium` (36px) fica nítido em telas HiDPI mesmo desenhado a 16-20px. */
export function iconUrl(icon: string, size: 'small' | 'medium' = 'medium'): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}

/** Extrai a descrição (bloco `<div class="q">`) do HTML do tooltip. */
export function tooltipText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const desc = doc.querySelector('.q') ?? doc.body;
  desc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (desc.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** undefined = ainda não sabemos; null = o Wowhead não tem esse spell. */
export function cachedTooltip(id: number, kind: TooltipKind = 'spell'): SpellTooltip | null | undefined {
  const key = keyOf(id, kind);
  if (memory.has(key)) return memory.get(key);
  try {
    const raw = localStorage.getItem(CACHE_KEY + key);
    if (raw) {
      const t = JSON.parse(raw) as SpellTooltip;
      memory.set(key, t);
      return t;
    }
  } catch {
    /* sem storage */
  }
  return undefined;
}

function writeCache(key: string, t: SpellTooltip | null) {
  memory.set(key, t);
  if (!t) return; // "não existe" só na memória: pode aparecer no Wowhead depois
  try {
    localStorage.setItem(CACHE_KEY + key, JSON.stringify(t));
  } catch {
    /* sem storage: fica só na memória */
  }
}

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const run = () => {
      running++;
      job()
        .then(resolve)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

export function fetchTooltip(id: number, kind: TooltipKind = 'spell'): Promise<SpellTooltip | null> {
  const cached = cachedTooltip(id, kind);
  if (cached !== undefined) return Promise.resolve(cached);
  const key = keyOf(id, kind);
  let p = inflight.get(key);
  if (!p) {
    p = schedule(() =>
      fetch(`https://nether.wowhead.com/tooltip/${kind}/${id}?dataEnv=1&locale=0`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { name?: string; icon?: string; tooltip?: string; quality?: number } | null) => {
          const t: SpellTooltip | null = j?.tooltip
            ? { name: j.name ?? '', icon: j.icon ?? null, text: tooltipText(j.tooltip), ...(j.quality != null && { quality: j.quality }) }
            : null;
          writeCache(key, t);
          return t;
        })
        .catch(() => null),
    ).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Tooltip de um spell (ou item); `enabled` evita buscar antes da hora (ex.: fora da tela). */
export function useTooltip(id: number, enabled = true, kind: TooltipKind = 'spell'): SpellTooltip | null | undefined {
  const [tip, setTip] = useState<SpellTooltip | null | undefined>(() => cachedTooltip(id, kind));
  useEffect(() => {
    setTip(cachedTooltip(id, kind));
  }, [id, kind]);
  useEffect(() => {
    if (!enabled || tip !== undefined) return;
    let alive = true;
    fetchTooltip(id, kind).then((t) => alive && setTip(t));
    return () => {
      alive = false;
    };
  }, [id, kind, enabled, tip]);
  return tip;
}
