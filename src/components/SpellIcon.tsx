import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Mountain, Swords } from 'lucide-react';
import { iconUrl, useTooltip, type TooltipKind } from '../lib/wowhead';

/** No wipe-core, Melee é o spell 1 e dano de ambiente (queda, lava) é o 0. */
const MELEE = 1;
const ENVIRONMENT = 0;

/**
 * Carregar os ícones já, sem esperar entrar na tela: para os cartões de compartilhar, que
 * são renderizados fora da tela e viram imagem.
 */
export const EagerIcons = createContext(false);

interface Props {
  spellId: number | null | undefined;
  size?: number;
  /** item em vez de spell (mesmo endpoint do Wowhead) */
  kind?: TooltipKind;
  /** nome do ícone já conhecido (ex.: talentos): não busca o tooltip */
  icon?: string | null;
  /** nome da habilidade no tooltip, onde só cabe o ícone (marcas da linha do tempo) */
  title?: string;
  /** abre a descrição do Wowhead com o mouse em cima (falso quando o nome ao lado já abre) */
  hover?: boolean;
}

/**
 * Ícone da habilidade (Wowhead), carregado só quando entra na tela. Enquanto carrega, ou se o
 * spell não existe no Wowhead, fica um quadrado neutro do mesmo tamanho (sem pulo de layout).
 */
export function SpellIcon({ spellId, size = 18, kind = 'spell', icon, title, hover = true }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const eager = useContext(EagerIcons);
  const [visible, setVisible] = useState(eager);
  const special = kind === 'spell' && (spellId === MELEE || spellId === ENVIRONMENT || spellId == null);
  const tip = useTooltip(spellId ?? -1, visible && !special && !icon && spellId != null, kind);
  const iconName = icon ?? tip?.icon;

  useEffect(() => {
    const el = ref.current;
    if (!el || visible || special) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, special]);

  const style = { width: size, height: size };
  // com `title` o ícone é o nome (leitor de tela e tooltip); sem, é enfeite ao lado do nome escrito
  const a11y = title ? { role: 'img', 'aria-label': title, title } : { 'aria-hidden': true };
  // habilidade: a descrição do Wowhead abre no cartão (SpellHoverLayer), com o `title` como linha
  // a mais em vez do tooltip nativo (senão abrem os dois)
  const withHover = hover && kind === 'spell' && !special && spellId != null;
  const hoverAttrs = withHover ? { 'data-spell-id': spellId, ...(title && { 'data-spell-extra': title }) } : {};
  if (spellId === MELEE)
    return (
      <span className="spell-icon glyph" style={style} {...a11y}>
        <Swords size={size - 6} strokeWidth={1.75} />
      </span>
    );
  if (spellId === ENVIRONMENT)
    return (
      <span className="spell-icon glyph" style={style} {...a11y}>
        <Mountain size={size - 6} strokeWidth={1.75} />
      </span>
    );
  return (
    <span ref={ref} className={`spell-icon${title ? ' has-tip' : ''}`} style={style} {...a11y} {...hoverAttrs} {...(withHover && title && { title: undefined })}>
      {iconName && (
        <img src={iconUrl(iconName)} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async" crossOrigin="anonymous" />
      )}
    </span>
  );
}

/** Ícone + nome da habilidade numa linha. */
export function SpellName({ spellId, name, size = 18, icon }: { spellId: number | null | undefined; name: string; size?: number; icon?: string | null }) {
  return (
    <span className="spell-name" {...(spellId != null && spellId > 1 && { 'data-spell-id': spellId })}>
      <SpellIcon spellId={spellId} size={size} icon={icon} hover={false} />
      <span className="spell-name-text">{name}</span>
    </span>
  );
}

/** Ícone da habilidade dentro de um SVG (mapa do replay); enquanto carrega, um quadrado neutro. */
export function SvgSpellIcon({ spellId, x, y, size, title }: { spellId: number; x: number; y: number; size: number; title?: string }) {
  const tip = useTooltip(spellId, true);
  return (
    <g data-spell-id={spellId} {...(title && { role: 'img', 'aria-label': title })}>
      <rect x={x - 1} y={y - 1} width={size + 2} height={size + 2} rx={3} className="svg-spell-frame" />
      {tip?.icon && <image href={iconUrl(tip.icon)} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid slice" />}
    </g>
  );
}
