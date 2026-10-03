// Discord no modo ao vivo, tudo como imagem (o mesmo cartão do "Compartilhar"):
//   wipe -> o cartão do pull (motivo do wipe), kill -> o resumo do boss, fim da raid -> o
//   resumo da noite. O fim da raid é quando o ao vivo é desligado ou 30 min sem pull novo.

import { useCallback, useEffect, useRef } from 'react';
import type { Pull } from '../types';
import { discordGetConfig } from './api';
import { raidOnly } from './content';
import { bossKey } from './night';
import { lowestBossHp } from './verdict';
import { PlayerClassesContext, playerClasses } from './players';
import { cardPng, fileSlug, sendPngToDiscord } from './share';
import { pct } from './format';
import { BossShareCard, NightShareCard, PullShareCard } from '../components/ShareCards';

/** Sem pull novo por isso, a raid acabou: vai o resumo da noite. */
const NIGHT_IDLE_MS = 30 * 60_000;

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
    await send(<PullShareCard pull={p} />, all, `Wipe ${p.pullNumber} · ${bossKey(p)} · boss em ${pct(lowestBossHp(p))}`);
  }
}

export async function postNightImage(all: Pull[]) {
  const raid = raidOnly(all);
  if (!raid.length) return;
  const day = raid[0].startLocal.split(' ')[0]?.split('/').slice(0, 2).reverse().join('/') ?? '';
  await send(<NightShareCard pulls={all} />, all, `Resumo da noite · ${day}`);
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
