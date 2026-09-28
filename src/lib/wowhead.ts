// Descrição de spells/debuffs: o combat log não traz tooltip, então buscamos no Wowhead
// (endpoint público de tooltips) e guardamos no localStorage.

import { useEffect, useState } from 'react';

export interface SpellTooltip {
  name: string;
  icon: string | null;
  /** texto da descrição, sem HTML */
  text: string;
}

const CACHE_KEY = 'wipe-cause:wowhead:';
const inflight = new Map<number, Promise<SpellTooltip | null>>();

export function wowheadUrl(spellId: number): string {
  return `https://www.wowhead.com/spell=${spellId}`;
}

export function iconUrl(icon: string): string {
  return `https://wow.zamimg.com/images/wow/icons/small/${icon}.jpg`;
}

/** Extrai a descrição (bloco `<div class="q">`) do HTML do tooltip. */
export function tooltipText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const desc = doc.querySelector('.q') ?? doc.body;
  desc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (desc.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function readCache(id: number): SpellTooltip | null | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY + id);
    return raw ? (JSON.parse(raw) as SpellTooltip) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(id: number, t: SpellTooltip) {
  try {
    localStorage.setItem(CACHE_KEY + id, JSON.stringify(t));
  } catch {
    /* sem storage: só não guarda */
  }
}

export function fetchTooltip(spellId: number): Promise<SpellTooltip | null> {
  const cached = readCache(spellId);
  if (cached !== undefined) return Promise.resolve(cached);
  let p = inflight.get(spellId);
  if (!p) {
    p = fetch(`https://nether.wowhead.com/tooltip/spell/${spellId}?dataEnv=1&locale=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { name?: string; icon?: string; tooltip?: string } | null) => {
        if (!j?.tooltip) return null;
        const t: SpellTooltip = { name: j.name ?? '', icon: j.icon ?? null, text: tooltipText(j.tooltip) };
        writeCache(spellId, t);
        return t;
      })
      .catch(() => null)
      .finally(() => inflight.delete(spellId));
    inflight.set(spellId, p);
  }
  return p;
}

/** Tooltip de um spell; `enabled` evita buscar antes de o usuário abrir o detalhe. */
export function useTooltip(spellId: number, enabled = true): SpellTooltip | null | undefined {
  const [tip, setTip] = useState<SpellTooltip | null | undefined>(() => readCache(spellId));
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
