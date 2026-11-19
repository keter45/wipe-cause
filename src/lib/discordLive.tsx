// Discord no modo ao vivo, tudo como imagem: os mesmos posts do "Compartilhar" (lib/sharePosts):
//   wipe -> o cartão do pull (motivo do wipe) e o clipe com o resumo da try, kill -> o resumo do boss, fim da raid -> o
//   resumo da noite e, em outra mensagem, os cartões das Métricas do grupo. O fim da raid é quando o ao vivo é desligado ou 30 min sem pull novo.

import { useCallback, useEffect, useRef } from 'react';
import type { Pull } from '../types';
import { discordGetConfig } from './api';
import { raidOnly } from './content';
import { bossKey } from './night';
import { playerClasses } from './players';
import { bossPosts, nightPosts, pullPosts, sendPosts } from './sharePosts';

/** Sem pull novo por isso, a raid acabou: vai o resumo da noite. */
const NIGHT_IDLE_MS = 30 * 60_000;

/** Um pull que acabou: wipe = o motivo do wipe (com o clipe); kill = o resumo do boss (todos os pulls até o kill). */
export async function postPullImage(p: Pull, all: Pull[]) {
  const key = bossKey(p);
  await sendPosts(p.success ? bossPosts(key, all.filter((x) => bossKey(x) === key)) : pullPosts(p), playerClasses(all));
}

export async function postNightImage(all: Pull[]) {
  await sendPosts(nightPosts(all), playerClasses(all));
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
