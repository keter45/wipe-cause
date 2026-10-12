import { useContext, useMemo, useState, type ReactNode } from 'react';
import { classColor, shortName } from '../lib/format';
import { classOf, richRegex, type PlayerClasses, usePlayerClasses } from '../lib/players';
import { EagerIcons, SpellName } from './SpellIcon';

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

/** Num texto livre: personagem na cor da classe e habilidade com o ícone ao lado do nome. */
export function withRichNames(text: string, keyBase: string, pc: PlayerClasses, re: RegExp | null, plainStart = false): ReactNode[] {
  if (!re || !text) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  let skip = plainStart;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const id = pc.spells.get(m[0]);
    // a linha já tem o ícone da habilidade principal na frente: a primeira citada fica sem outro
    if (id != null && skip) {
      skip = false;
      out.push(m[0]);
      last = m.index! + m[0].length;
      continue;
    }
    out.push(
      id != null ? (
        <span key={`${keyBase}-${m.index}`} className="spell-inline">
          <SpellName spellId={id} name={m[0]} size={14} />
        </span>
      ) : (
        <PlayerName key={`${keyBase}-${m.index}`} name={m[0]} />
      ),
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** O texto cita alguma habilidade do log? (aí o ícone já sai junto do nome, sem outro na frente) */
export function useMentionsSpell(): (text: string) => boolean {
  const pc = usePlayerClasses();
  return useMemo(() => {
    const re = pc.spells.size ? new RegExp(richRegex({ ...pc, names: [] })!.source, 'u') : null;
    return (text: string) => !!re && re.test(text);
  }, [pc]);
}

/**
 * Frase com os nomes de personagem coloridos e o ícone ao lado de cada habilidade citada (veredito,
 * resumos, dicas da rotação e do healer, Evolução). `plainStart`: a linha já tem o ícone na frente,
 * então a primeira habilidade citada fica sem outro.
 */
export function Colored({ text, plainStart = false }: { text: string; plainStart?: boolean }) {
  const pc = usePlayerClasses();
  const re = useMemo(() => richRegex(pc), [pc]);
  return <>{withRichNames(text, 'n', pc, re, plainStart)}</>;
}
