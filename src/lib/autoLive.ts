// Ao vivo automático: com a conta do Warcraft Logs, o app olha a guilda de tempos em tempos e,
// quando alguém começa a subir o log ao vivo, liga o modo ao vivo sozinho (que ainda prefere o
// log deste PC, se o WoW estiver escrevendo um). Desligado à mão, não volta na mesma noite.

import { useEffect, useRef } from 'react';
import { inTauri } from './api';
import { fetchGuildReports, groupNights } from './guildNights';
import type { WclGuild } from './wclApi';

const CHECK_MS = 2 * 60_000;
/** Quem desligou o ao vivo não quer que ele volte nesta raid. */
const DISMISS_MS = 6 * 3_600_000;

const KEY = 'wipe-cause:auto-live';
export function autoLiveEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setAutoLiveEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* sem storage */
  }
}

export function useAutoLive(guild: WclGuild | null, active: boolean, start: () => void) {
  const dismissedAt = useRef(0);
  const wasActive = useRef(active);
  const startRef = useRef(start);
  startRef.current = start;

  // desligou (depois de estar ligado): não religa sozinho por um tempo
  useEffect(() => {
    if (wasActive.current && !active) dismissedAt.current = Date.now();
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!inTauri || !guild || active) return;
    let alive = true;
    const check = async () => {
      if (!autoLiveEnabled() || Date.now() - dismissedAt.current < DISMISS_MS) return;
      const nights = await fetchGuildReports(guild, 1).then(groupNights).catch(() => []);
      if (alive && nights.some((n) => n.live)) startRef.current();
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [guild, active]);
}
