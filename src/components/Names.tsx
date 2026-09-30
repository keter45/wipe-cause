import { useContext, useMemo, useState, type ReactNode } from 'react';
import { classColor, shortName } from '../lib/format';
import { classOf, namesRegex, usePlayerClasses } from '../lib/players';
import { EagerIcons } from './SpellIcon';

/** Ícone do boss (arte do Warcraft Logs pelo ID do encontro). */
export const bossIconUrl = (encounterId: number) => `https://assets.rpglogs.com/img/warcraft/bosses/${encounterId}-icon.jpg`;

/** Ícone do boss; sem arte (403) fica um quadrado neutro do mesmo tamanho. */
export function BossIcon({ encounterId, size = 18 }: { encounterId: number | null | undefined; size?: number }) {
  const eager = useContext(EagerIcons);
  const [failed, setFailed] = useState(false);
  return (
    <span className="spell-icon boss-icon" style={{ width: size, height: size }} aria-hidden>
      {encounterId != null && !failed && (
        <img
          src={bossIconUrl(encounterId)}
          alt=""
          width={size}
          height={size}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** Ícone + nome do boss. */
export function BossName({ encounterId, name, size = 18, children }: { encounterId: number | null | undefined; name: ReactNode; size?: number; children?: ReactNode }) {
  return (
    <span className="spell-name boss-name">
      <BossIcon encounterId={encounterId} size={size} />
      <span className="spell-name-text">{name}</span>
      {children}
    </span>
  );
}

/**
 * Nome do personagem na cor da classe. `cls` explícita vence; senão procura no log aberto
 * (por guid ou nome). Mostra o nome curto (sem o reino), a não ser que `full`.
 */
export function PlayerName({ name, guid, cls, full = false }: { name: string; guid?: string | null; cls?: string | null; full?: boolean }) {
  const pc = usePlayerClasses();
  const c = cls ?? classOf(pc, guid) ?? classOf(pc, name);
  return (
    <span className="player-name" style={{ color: classColor(c) }}>
      {full ? name : shortName(name)}
    </span>
  );
}

/** Troca, num texto livre, os nomes dos personagens do log pelo nome colorido. */
export function withPlayerNames(text: string, keyBase: string, re: RegExp | null): ReactNode[] {
  if (!re || !text) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<PlayerName key={`${keyBase}-${m.index}`} name={m[0]} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texto com os nomes de personagem coloridos (para frases do veredito, resumos, Evolução). */
export function Colored({ text }: { text: string }) {
  const pc = usePlayerClasses();
  const re = useMemo(() => namesRegex(pc), [pc]);
  return <>{withPlayerNames(text, 'n', re)}</>;
}
