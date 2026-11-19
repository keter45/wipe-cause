// Peças comuns dos cartões de compartilhar (imagem, HTML, PDF). Cada cartão tem duas versões: o
// resumo (o que cabe numa olhada no Discord) e o completo (tudo aberto, para quem quer o detalhe).

import type { ReactNode } from 'react';
import { classColor, shortName } from '../../lib/format';
import { scoreTier } from '../../lib/score';
import { useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

export type CardDetail = 'summary' | 'full';

/** Nota abaixo disto é "precisa de atenção" (a mesma linha do tom das notas no app). */
export { ATTENTION_SCORE } from '../../lib/score';

export function Brand() {
  return <span className="share-brand">Wipe Cause</span>;
}

/** Data e hora do pull nos cartões: as mesmas do app. */
export { dayMonth as dateOf, clockOf as timeOf } from '../../lib/format';

/** Duração longa nos cartões: a mesma do app ("2h 13min"). */
export { longDuration as hm } from '../../lib/format';

/** Cartão: borda do resultado, cabeçalho (título, linha de baixo, número grande) e rodapé. */
export function Card({
  tone,
  wide = false,
  title,
  sub,
  big,
  bigTone,
  foot,
  className = '',
  children,
}: {
  tone: 'kill' | 'wipe' | 'neutral';
  /** classe extra do cartão (largura própria) */
  className?: string;
  /** cartão completo: mais largo, para as tabelas */
  wide?: boolean;
  title: ReactNode;
  sub: ReactNode;
  big?: ReactNode;
  bigTone?: string;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`share-card ${tone} ${wide ? 'wide' : ''} ${className}`}>
      <header className="share-head">
        <div>
          <div className="share-title">{title}</div>
          <div className="share-sub">{sub}</div>
        </div>
        {big != null && <div className={`share-big ${bigTone ?? ''}`}>{big}</div>}
      </header>
      {children}
      <footer className="share-foot">
        {foot && <span className="share-muted">{foot}</span>}
        <Brand />
      </footer>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="share-section">
      <h4>
        {title}
        {aside && <span className="share-aside"> {aside}</span>}
      </h4>
      {children}
    </section>
  );
}

/** Nome na cor da classe. */
export const Who = ({ name, cls }: { name: string; cls: string | null | undefined }) => <span style={{ color: classColor(cls) }}>{shortName(name)}</span>;

/** Nomes com a nota ao lado. */
export function ScoreChips({ list }: { list: { guid: string; name: string; class: string | null; score: number }[] }) {
  return (
    <div className="share-scores">
      {list.map((x) => (
        <span key={x.guid}>
          <Who name={x.name} cls={x.class} /> <span className={`score-pill ${scoreTier(x.score)}`}>{Math.round(x.score)}</span>
        </span>
      ))}
    </div>
  );
}

/** "+3 mais" no fim de uma lista cortada do resumo. */
export function More({ n }: { n: number }) {
  const t = useMessages(shareMsg);
  return n > 0 ? <li className="share-more">{t.more(n)}</li> : null;
}
