import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** o botão que abre o popover (fica como âncora) */
  trigger: ReactNode;
  children: ReactNode;
  label: string;
}

/** Painel flutuante ancorado num botão; fecha com Esc ou clique fora. */
export function Popover({ open, onClose, trigger, children, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="popover-anchor" ref={ref}>
      {trigger}
      {open && (
        <div className="popover" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
