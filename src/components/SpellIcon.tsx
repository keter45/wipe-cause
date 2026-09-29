import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Mountain, Swords } from 'lucide-react';
import { iconUrl, useTooltip } from '../lib/wowhead';

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
}

/**
 * Ícone da habilidade (Wowhead), carregado só quando entra na tela. Enquanto carrega, ou se o
 * spell não existe no Wowhead, fica um quadrado neutro do mesmo tamanho (sem pulo de layout).
 */
export function SpellIcon({ spellId, size = 18 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const eager = useContext(EagerIcons);
  const [visible, setVisible] = useState(eager);
  const special = spellId === MELEE || spellId === ENVIRONMENT || spellId == null;
  const tip = useTooltip(spellId ?? -1, visible && !special);

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
  if (spellId === MELEE)
    return (
      <span className="spell-icon glyph" style={style} aria-hidden>
        <Swords size={size - 6} strokeWidth={1.75} />
      </span>
    );
  if (spellId === ENVIRONMENT)
    return (
      <span className="spell-icon glyph" style={style} aria-hidden>
        <Mountain size={size - 6} strokeWidth={1.75} />
      </span>
    );
  return (
    <span ref={ref} className="spell-icon" style={style} aria-hidden>
      {tip?.icon && (
        <img src={iconUrl(tip.icon)} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async" crossOrigin="anonymous" />
      )}
    </span>
  );
}

/** Ícone + nome da habilidade numa linha. */
export function SpellName({ spellId, name, size = 18 }: { spellId: number | null | undefined; name: string; size?: number }) {
  return (
    <span className="spell-name">
      <SpellIcon spellId={spellId} size={size} />
      <span className="spell-name-text">{name}</span>
    </span>
  );
}
