// O que cada "Compartilhar" gera, num lugar só: o menu Compartilhar (imagem, HTML, PDF, Discord)
// e o Discord automático do ao vivo usam os mesmos posts. Mudou um cartão, um título ou o que vai
// junto (clipe, métricas do grupo), muda nos dois.
//
// Um post = um cartão (e, no wipe, o clipe da try) = uma mensagem no Discord.

import type { ReactElement } from 'react';
import type { Pull } from '../types';
import type { Trends } from './trends';
import { discordGetConfig } from './api';
import { raidOnly } from './content';
import { nightBossMetrics } from './bossMetrics';
import { PlayerClassesContext, type PlayerClasses } from './players';
import { cardPng, clipFileName, fileSlug, sendToDiscord } from './share';
import { clipMoments, type ClipMoment } from './replayClip';
import { bossTitle, pullTitle } from './discord';
import { messagesOf } from '../i18n';
import { discordMsg } from './discord.i18n';
import type { CardDetail } from '../components/share/common';
import { dayMonth } from './format';
import { PullShareCard } from '../components/share/PullCard';
import { BossShareCard } from '../components/share/BossCard';
import { NightShareCard } from '../components/share/NightCard';
import { MetricsShareCard } from '../components/share/MetricsCard';
import { EvolutionShareCard } from '../components/share/EvolutionCard';

export interface SharePost {
  /** título da mensagem no Discord e base do nome do arquivo */
  title: string;
  card: ReactElement;
  /** o pull e os erros que levaram ao wipe: o clipe (WebP) vai junto */
  clip?: { pull: Pull; moments: ClipMoment[] } | null;
}

/** O clipe demorou demais (algo travou): vai só o cartão. */
const CLIP_TIMEOUT_MS = 3 * 60_000;

const msg = () => messagesOf(discordMsg);

/** Um pull: o cartão do wipe (com o clipe dos erros que o causaram) ou do kill. */
export function pullPosts(p: Pull, detail: CardDetail = 'summary'): SharePost[] {
  const moments = p.success ? [] : clipMoments(p);
  return [
    {
      title: pullTitle(p),
      card: <PullShareCard pull={p} detail={detail} />,
      clip: moments.length ? { pull: p, moments } : null,
    },
  ];
}

/** Um boss na noite (todos os pulls dele). */
export function bossPosts(key: string, pulls: Pull[], detail: CardDetail = 'summary'): SharePost[] {
  return [{ title: bossTitle(key, pulls.some((p) => p.success)), card: <BossShareCard title={key} pulls={pulls} detail={detail} /> }];
}

/** A noite (só raid) e, à parte, os cartões completos das Métricas do grupo de cada boss. */
export function nightPosts(all: Pull[], detail: CardDetail = 'summary'): SharePost[] {
  const raid = raidOnly(all);
  if (!raid.length) return [];
  const day = dayMonth(raid[0]);
  return [
    { title: msg().nightTitle(day), card: <NightShareCard pulls={all} detail={detail} /> },
    ...(nightBossMetrics(raid).length ? [{ title: msg().metricsTitle(day), card: <MetricsShareCard pulls={all} /> }] : []),
  ];
}

/** A Evolução de um boss entre as noites. */
export function evolutionPosts(tr: Trends, boss: string, detail: CardDetail = 'summary'): SharePost[] {
  if (!tr.nights.length) return [];
  return [{ title: msg().evolutionTitle(boss), card: <EvolutionShareCard tr={tr} boss={boss} detail={detail} /> }];
}

/** Nome do arquivo de um post (sem extensão). */
export const postFile = (post: SharePost) => fileSlug(post.title) || 'wipe-cause';

/** O cartão com as cores de classe de quem aparece nele. */
export const withClasses = (card: ReactElement, classes: PlayerClasses) => <PlayerClassesContext.Provider value={classes}>{card}</PlayerClassesContext.Provider>;

/** O clipe do post (o motor do replay só carrega aqui); null se não tem ou se demorou demais. */
export async function postClip(post: SharePost): Promise<{ bytes: Uint8Array; name: string } | null> {
  const c = post.clip;
  if (!c) return null;
  const { replayClip } = await import('./replayClip');
  const bytes = await Promise.race([
    replayClip(c.pull, c.moments, { title: `Pull ${c.pull.pullNumber} · ${c.pull.encounterName}` }),
    new Promise<null>((ok) => setTimeout(() => ok(null), CLIP_TIMEOUT_MS)),
  ]);
  if (!bytes) return null;
  const what = c.moments.length === 1 ? c.moments[0].label : '';
  return { bytes, name: clipFileName(post.title, what) };
}

/**
 * Manda os posts ao webhook, um por mensagem, na ordem. O clipe vai junto do cartão se o Discord
 * estiver com o clipe ligado; se não der para desenhar, vai só o cartão.
 */
export async function sendPosts(posts: SharePost[], classes: PlayerClasses) {
  const cfg = posts.some((p) => p.clip) ? await discordGetConfig().catch(() => null) : null;
  for (const post of posts) {
    const png = await cardPng(withClasses(post.card, classes));
    const name = `${postFile(post)}.png`;
    const clip = cfg?.clip === false ? null : await postClip(post).catch(() => null);
    await sendToDiscord(post.title, { png: { dataUrl: png, name }, clip: clip ?? undefined });
  }
}
