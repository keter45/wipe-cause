// Nome, ícone e descrição de spells: o combat log não traz nada disso além do nome, então
// buscamos no endpoint público de tooltips do Wowhead e guardamos no localStorage.

import { useEffect, useState } from 'react';

export interface SpellTooltip {
  name: string;
  icon: string | null;
  /** texto da descrição, sem HTML */
  text: string;
}

const CACHE_KEY = 'wipe-cause:wowhead:';
/** buscas simultâneas no Wowhead (um recap tem dezenas de spells) */
const MAX_CONCURRENT = 4;

const memory = new Map<number, SpellTooltip | null>();
const inflight = new Map<number, Promise<SpellTooltip | null>>();
const queue: (() => void)[] = [];
let running = 0;

export function wowheadUrl(spellId: number): string {
  return `https://www.wowhead.com/spell=${spellId}`;
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
export function cachedTooltip(id: number): SpellTooltip | null | undefined {
  if (memory.has(id)) return memory.get(id);
  try {
    const raw = localStorage.getItem(CACHE_KEY + id);
    if (raw) {
      const t = JSON.parse(raw) as SpellTooltip;
      memory.set(id, t);
      return t;
    }
  } catch {
    /* sem storage */
  }
  return undefined;
}

function writeCache(id: number, t: SpellTooltip | null) {
  memory.set(id, t);
  if (!t) return; // "não existe" só na memória: pode aparecer no Wowhead depois
  try {
    localStorage.setItem(CACHE_KEY + id, JSON.stringify(t));
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

export function fetchTooltip(spellId: number): Promise<SpellTooltip | null> {
  const cached = cachedTooltip(spellId);
  if (cached !== undefined) return Promise.resolve(cached);
  let p = inflight.get(spellId);
  if (!p) {
    p = schedule(() =>
      fetch(`https://nether.wowhead.com/tooltip/spell/${spellId}?dataEnv=1&locale=0`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { name?: string; icon?: string; tooltip?: string } | null) => {
          const t: SpellTooltip | null = j?.tooltip
            ? { name: j.name ?? '', icon: j.icon ?? null, text: tooltipText(j.tooltip) }
            : null;
          writeCache(spellId, t);
          return t;
        })
        .catch(() => null),
    ).finally(() => inflight.delete(spellId));
    inflight.set(spellId, p);
  }
  return p;
}

/** Tooltip de um spell; `enabled` evita buscar antes da hora (ex.: fora da tela). */
export function useTooltip(spellId: number, enabled = true): SpellTooltip | null | undefined {
  const [tip, setTip] = useState<SpellTooltip | null | undefined>(() => cachedTooltip(spellId));
  useEffect(() => {
    setTip(cachedTooltip(spellId));
  }, [spellId]);
  useEffect(() => {
    if (!enabled || tip !== undefined) return;
    let alive = true;
    fetchTooltip(spellId).then((t) => alive && setTip(t));
    return () => {
      alive = false;
    };
  }, [spellId, enabled, tip]);
  return tip;
}
