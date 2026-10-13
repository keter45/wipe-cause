import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useMessages } from '../../i18n';
import { uiMsg } from './ui.i18n';

/**
 * Explicação sob demanda: um (i) ao lado de um título ou rótulo. Abre ao passar o mouse, ao focar
 * pelo teclado ou ao clicar (toque); fecha com Esc, clique fora ou saindo. Para o texto que ajuda
 * a entender a tela uma vez, mas não precisa ocupar espaço toda vez.
 */
export function Hint({ children, label }: { children: ReactNode; label?: string }) {
  const t = useMessages(uiMsg);
  const id = useId();
  const [open, setOpen] = useState(false);
  // aberto pelo clique fica até fechar; o hover só enquanto o mouse está em cima
  const [pinned, setPinned] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // abre para o lado que cabe na tela
  useLayoutEffect(() => {
    if (!open || !popRef.current || !ref.current) return;
    const anchor = ref.current.getBoundingClientRect();
    const width = popRef.current.offsetWidth;
    setSide(anchor.left + width + 16 > window.innerWidth ? 'right' : 'left');
  }, [open]);

  return (
    <span className="hint" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button
        type="button"
        className={`hint-btn ${open ? 'open' : ''}`}
        aria-label={label ?? t.hint}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
      >
        <Info size={14} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <span role="tooltip" id={id} ref={popRef} className={`hint-pop ${side}`}>
          {children}
        </span>
      )}
    </span>
  );
}
