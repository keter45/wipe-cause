import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconUrl, useSpellDescription, useTooltip } from '../lib/wowhead';
import { useMessages } from '../i18n';
import { spellHoverMsg } from './SpellHover.i18n';

/** Mouse parado este tanto sobre uma habilidade abre a descrição (passar por cima não abre). */
const OPEN_DELAY_MS = 300;
/** Distância entre o nome e o cartão, e margem da borda da janela. */
const GAP = 6;
const EDGE = 8;

interface Open {
  id: number;
  rect: DOMRect;
  /** linha a mais (ex.: boss e momento, numa marca de linha do tempo) */
  extra: string | null;
}

/**
 * Descrição do Wowhead de qualquer habilidade citada no app: todo ícone ou nome de habilidade
 * (`data-spell-id`) abre este cartão com o mouse parado em cima. Um só cartão para a janela toda,
 * fora das tabelas e do mapa (não é cortado por áreas com rolagem).
 */
export function SpellHoverLayer() {
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setOpen(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-spell-id]') ?? null;
      if (el === current) return;
      current = el;
      window.clearTimeout(timer);
      if (!el) {
        setOpen(null);
        return;
      }
      timer = window.setTimeout(() => {
        const id = Number(el.getAttribute('data-spell-id'));
        if (id > 1) setOpen({ id, rect: el.getBoundingClientRect(), extra: el.getAttribute('data-spell-extra') });
      }, OPEN_DELAY_MS);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!open) return null;
  return createPortal(<SpellCard key={`${open.id}:${open.rect.top}:${open.rect.left}`} {...open} />, document.body);
}

function SpellCard({ id, rect, extra }: Open) {
  const t = useMessages(spellHoverMsg);
  const tip = useTooltip(id, true);
  const text = useSpellDescription(id, true);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // embaixo do nome; sem espaço, em cima. Nunca para fora da janela.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE);
    const below = rect.bottom + GAP;
    const top = below + height + EDGE <= window.innerHeight ? below : Math.max(EDGE, rect.top - GAP - height);
    setPos({ left, top });
  }, [rect, tip, text]);

  // sem descrição no Wowhead: nada (o nome já está na tela)
  if (tip === null) return null;
  // a linha a mais costuma começar pelo nome do spell, que já é o título do cartão
  const sub = extra && tip?.name && extra.startsWith(`${tip.name} · `) ? extra.slice(tip.name.length + 3) : extra;
  return (
    <div ref={ref} className="spell-card" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      <div className="spell-card-head">
        {tip?.icon && <img src={iconUrl(tip.icon)} alt="" width={28} height={28} />}
        <div>
          <strong>{tip?.name || '…'}</strong>
          {sub && <span className="muted small">{sub}</span>}
        </div>
      </div>
      {text === undefined ? <p className="muted small">{t.loading}</p> : text && <p className="spell-card-text">{text}</p>}
      <span className="spell-card-src">{t.source}</span>
    </div>
  );
}
