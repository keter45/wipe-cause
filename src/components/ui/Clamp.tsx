import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMessages } from '../../i18n';
import { uiMsg } from './ui.i18n';

/**
 * Texto longo (dica de mecânica, explicação) cortado em `lines` linhas; "mais" abre o resto. O
 * botão só aparece quando o texto realmente não cabe.
 */
export function Clamp({ children, className = '', lines = 1 }: { children: ReactNode; className?: string; lines?: number }) {
  const t = useMessages(uiMsg);
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);

  return (
    <span className={`clamp ${lines > 1 ? 'multi' : ''} ${open ? 'open' : ''} ${className}`} style={{ '--lines': lines } as CSSProperties}>
      <span ref={ref} className="clamp-text">
        {children}
      </span>
      {(overflows || open) && (
        <button type="button" className="link small clamp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.less : t.more}
        </button>
      )}
    </span>
  );
}
