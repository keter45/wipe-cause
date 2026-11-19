import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMessages } from '../i18n';
import { collapsiblePanelMsg } from './CollapsiblePanel.i18n';
import { KEYS, ls } from '../lib/storage';


/** Escolha de aberto/recolhido no navegador; `key` segue a convenção `wipe-cause:<key>`. */
export function useCollapsed(key: string, defaultOpen = true): [boolean, () => void] {
  const storageKey = `${KEYS.collapse}${key}`;
  const [open, setOpen] = useState(() => ls.getBool(storageKey, defaultOpen));
  const toggle = () => {
    setOpen((old) => {
      const next = !old;
      ls.setBool(storageKey, next);
      return next;
    });
  };
  return [open, toggle];
}

/** Botão Recolher/Expandir do cabeçalho de um card. */
export function CollapseButton({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  const t = useMessages(collapsiblePanelMsg);
  const label = open ? t.collapse : t.expand;
  return (
    <button type="button" className={`btn ghost sm${className ? ` ${className}` : ''}`} onClick={onToggle} aria-expanded={open} aria-label={label} title={label}>
      {open ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden />} {label}
    </button>
  );
}

interface Props {
  storageKey: string;
  title: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Card recolhível: o mesmo cabeçalho com título e o botão, e o conteúdo só quando aberto. */
export function CollapsiblePanel({ storageKey, title, className, children }: Props) {
  const [open, toggle] = useCollapsed(storageKey);
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <header className="assign-head">
        <h3>{title}</h3>
        <CollapseButton open={open} onToggle={toggle} />
      </header>
      {open && children}
    </section>
  );
}
