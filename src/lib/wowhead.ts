// Nome, ícone e descrição de spells (e itens): o combat log não traz nada disso além do nome
// (ou só o ID, no caso dos itens), então buscamos no endpoint público de tooltips do Wowhead
// e guardamos no localStorage.

import { useEffect, useState } from 'react';
import { useLocale } from '../i18n';

export interface SpellTooltip {
  name: string;
  icon: string | null;
  /** texto da descrição, sem HTML */
  text: string;
  /** itens: 0 cinza … 4 épico, 5 lendário */
  quality?: number;
}

export type TooltipKind = 'spell' | 'item';
/**
 * Idioma do texto: o nome e o ícone vêm sempre do inglês (nomes de habilidade ficam em inglês no
 * app); a descrição pode vir em português.
 */
export type TooltipLang = 'en' | 'pt';
/** Código de idioma do endpoint de tooltips do Wowhead. */
const LOCALE_ID: Record<TooltipLang, number> = { en: 0, pt: 8 };
/** Spells em inglês guardados só pelo número (cache antigo); itens e outros idiomas com prefixo. */
const keyOf = (id: number, kind: TooltipKind, lang: TooltipLang = 'en') => (lang === 'en' ? '' : `${lang}:`) + (kind === 'spell' ? String(id) : `item:${id}`);

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
export function cachedTooltip(id: number, kind: TooltipKind = 'spell', lang: TooltipLang = 'en'): SpellTooltip | null | undefined {
  const key = keyOf(id, kind, lang);
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

export function fetchTooltip(id: number, kind: TooltipKind = 'spell', lang: TooltipLang = 'en'): Promise<SpellTooltip | null> {
  const cached = cachedTooltip(id, kind, lang);
  if (cached !== undefined) return Promise.resolve(cached);
  const key = keyOf(id, kind, lang);
  let p = inflight.get(key);
  if (!p) {
    p = schedule(() =>
      fetch(`https://nether.wowhead.com/tooltip/${kind}/${id}?dataEnv=1&locale=${LOCALE_ID[lang]}`)
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

/** Tempo de cast (ms) pelo texto do tooltip ("10 sec cast"); null se instantâneo, canalizado ou sem. */
export function castMsOf(t: SpellTooltip | null | undefined): number | null {
  const m = t?.text.match(/(\d+(?:\.\d+)?) sec cast/);
  return m ? Math.round(Number(m[1]) * 1000) : null;
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

/**
 * Descrição de um spell no idioma do app (português quando o app está em português). Enquanto o
 * texto traduzido não chega, ou se o Wowhead não tiver tradução, fica o inglês.
 * undefined = ainda buscando; null = o Wowhead não tem esse spell.
 */
export function useSpellDescription(id: number, enabled = true, kind: TooltipKind = 'spell'): string | null | undefined {
  const lang: TooltipLang = useLocale() === 'pt' ? 'pt' : 'en';
  const en = useTooltip(id, enabled, kind);
  const [local, setLocal] = useState<SpellTooltip | null | undefined>(() => (lang === 'en' ? undefined : cachedTooltip(id, kind, lang)));
  useEffect(() => {
    if (lang === 'en' || !enabled) return;
    const cached = cachedTooltip(id, kind, lang);
    setLocal(cached);
    if (cached !== undefined) return;
    let alive = true;
    fetchTooltip(id, kind, lang).then((t) => alive && setLocal(t));
    return () => {
      alive = false;
    };
  }, [id, kind, lang, enabled]);
  if (en === undefined) return lang === 'en' ? undefined : (local?.text ?? undefined);
  if (en === null) return local?.text ?? null;
  return (lang !== 'en' && local?.text) || en.text;
}
