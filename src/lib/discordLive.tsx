// Discord no modo ao vivo, tudo como imagem (o mesmo cartão do "Compartilhar"):
//   wipe -> o cartão do pull (motivo do wipe) e o clipe com o resumo da try, kill -> o resumo do boss, fim da raid -> o
//   resumo da noite. O fim da raid é quando o ao vivo é desligado ou 30 min sem pull novo.

import { useCallback, useEffect, useRef } from 'react';
import type { Pull } from '../types';
import { discordGetConfig } from './api';
import { raidOnly } from './content';
import { bossKey } from './night';
import { lowestBossHp } from './verdict';
import { PlayerClassesContext, playerClasses } from './players';
import { cardPng, fileSlug, sendPngToDiscord, sendToDiscord } from './share';
import { pct } from './format';
import { BossShareCard } from '../components/share/BossCard';
import { NightShareCard } from '../components/share/NightCard';
import { PullShareCard } from '../components/share/PullCard';
import { messagesOf } from '../i18n';
import { discordMsg } from './discord.i18n';
import { clipMoments, replayClip } from './replayClip';

/** Sem pull novo por isso, a raid acabou: vai o resumo da noite. */
const NIGHT_IDLE_MS = 30 * 60_000;
/** O clipe demorou demais (algo travou): vai só o cartão. */
const CLIP_TIMEOUT_MS = 3 * 60_000;

async function send(card: React.ReactElement, all: Pull[], title: string) {
  const png = await cardPng(<PlayerClassesContext.Provider value={playerClasses(all)}>{card}</PlayerClassesContext.Provider>);
  await sendPngToDiscord(png, `${fileSlug(title) || 'wipe-cause'}.png`, title);
}

/** Um pull que acabou: wipe = o motivo do wipe; kill = o resumo do boss (todos os pulls até o kill). */
export async function postPullImage(p: Pull, all: Pull[]) {
  if (p.success) {
    const key = bossKey(p);
    await send(<BossShareCard title={key} pulls={all.filter((x) => bossKey(x) === key)} />, all, `Kill · ${key}`);
  } else {
    const title = messagesOf(discordMsg).wipeTitle(p.pullNumber, bossKey(p), pct(lowestBossHp(p)));
    const cfg = await discordGetConfig().catch(() => null);
    const moments = cfg?.clip === false ? [] : clipMoments(p);
    if (!moments.length) return send(<PullShareCard pull={p} />, all, title);
    // o cartão e, junto, o clipe com o resumo da try (se não der para desenhar, vai só o cartão)
    const png = await cardPng(<PlayerClassesContext.Provider value={playerClasses(all)}>{<PullShareCard pull={p} />}</PlayerClassesContext.Provider>);
    const name = fileSlug(title) || 'wipe-cause';
    const clip = await Promise.race([
      replayClip(p, moments, { title: `Pull ${p.pullNumber} · ${p.encounterName}` }).catch(() => null),
      new Promise<null>((ok) => setTimeout(() => ok(null), CLIP_TIMEOUT_MS)),
    ]);
    if (clip) await sendToDiscord(title, { png: { dataUrl: png, name: `${name}.png` }, clip: { bytes: clip, name: `${name}.webp` } });
    else await sendPngToDiscord(png, `${name}.png`, title);
  }
}

export async function postNightImage(all: Pull[]) {
  const raid = raidOnly(all);
  if (!raid.length) return;
  const day = raid[0].startLocal.split(' ')[0]?.split('/').slice(0, 2).reverse().join('/') ?? '';
  await send(<NightShareCard pulls={all} />, all, messagesOf(discordMsg).nightTitle(day));
}

/**
 * Resumo da noite no fim da raid: `track(pulls)` a cada análise ao vivo com pull novo; ele sai
 * quando o ao vivo é desligado ou depois de 30 min sem pull novo (uma vez por noite).
 */
export function useNightRecap(liveActive: boolean) {
  const night = useRef<{ pulls: Pull[]; lastNewAt: number; sent: boolean } | null>(null);

  const flush = useCallback(async () => {
    const n = night.current;
    if (!n || n.sent || !raidOnly(n.pulls).length) return;
    n.sent = true;
    const cfg = await discordGetConfig().catch(() => null);
    if (!cfg?.webhook || cfg.auto === false || cfg.onNight === false) return;
    await postNightImage(n.pulls).catch(() => {
      n.sent = false; // tenta de novo na próxima
    });
  }, []);

  // desligou o ao vivo: a noite acabou
  const wasActive = useRef(liveActive);
  useEffect(() => {
    if (wasActive.current && !liveActive) void flush();
    wasActive.current = liveActive;
  }, [liveActive, flush]);

  // 30 min sem pull novo
  useEffect(() => {
    if (!liveActive) return;
    const timer = window.setInterval(() => {
      const n = night.current;
      if (n && !n.sent && Date.now() - n.lastNewAt > NIGHT_IDLE_MS) void flush();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [liveActive, flush]);

  // pull novo depois de um resumo (a raid voltou da pausa): outro resumo no fim
  return useCallback((pulls: Pull[]) => {
    night.current = { pulls, lastNewAt: Date.now(), sent: false };
  }, []);
}
