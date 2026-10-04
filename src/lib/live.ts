// Modo ao vivo na UI: liga/desliga o acompanhamento e avisa quais pulls são novos.
//
// Duas fontes: o log do WoW neste PC (o backend acompanha o arquivo; é o mais rápido) ou,
// sem log recente aqui e com a conta do Warcraft Logs, o report ao vivo da guilda: a cada
// minuto o app procura a noite ao vivo da guilda e reanalisa quando entra um pull novo (os
// pulls já baixados ficam em cache, só o novo é baixado).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogReport, Pull } from '../types';
import { analyzeLog, inTauri, liveStart, liveStatus, liveStop, logsList, onLiveReport, onLiveStatus, type LiveStatus } from './api';
import { fetchGuildReports, groupNights, uniquePulls, LIVE_MS } from './guildNights';
import type { WclGuild } from './wclApi';
import { messagesOf } from '../i18n';
import { liveMsg } from './live.i18n';

const OFF: LiveStatus = { active: false, state: 'stopped', file: null, encounter: null, analyzed: 0, message: null };
const WCL_POLL_MS = 60_000;

/** Mesmo pull em duas análises do mesmo log (o id muda se a numeração mudar). */
const pullKey = (p: Pull) => `${p.encounterId}:${p.startMs}`;

/**
 * `onReport(r, novos)`: cada reanálise; `novos` = pulls que não existiam na anterior (vazio
 * na primeira, que só mostra o que já tinha acontecido). `guild`: guilda do login do
 * Warcraft Logs (fonte quando não há log recente neste PC).
 */
export function useLive(onReport: (r: LogReport, newPulls: Pull[]) => void, guild: WclGuild | null) {
  const [status, setStatus] = useState<LiveStatus>(OFF);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const handler = useRef(onReport);
  handler.current = onReport;
  // acompanhamento pelo Warcraft Logs (null = desligado ou log local)
  const wcl = useRef<{ timer: number; path: string | null; pulls: number; busy: boolean } | null>(null);

  const deliver = useCallback((r: LogReport) => {
    const known = seen.current;
    const fresh = known ? r.pulls.filter((p) => !known.has(pullKey(p))) : [];
    seen.current = new Set(r.pulls.map(pullKey));
    handler.current(r, fresh);
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    liveStatus().then(setStatus).catch(() => {});
    const offStatus = onLiveStatus((s) => {
      if (!wcl.current) setStatus(s);
    });
    const offReport = onLiveReport(deliver);
    return () => {
      offStatus.then((f) => f());
      offReport.then((f) => f());
      if (wcl.current) window.clearInterval(wcl.current.timer);
    };
  }, [deliver]);

  /** Uma checagem da guilda: acha a noite ao vivo e reanalisa se entrou pull novo. */
  const wclTick = useCallback(
    async (g: WclGuild, deathCutoff: number) => {
      const w = wcl.current;
      if (!w || w.busy) return;
      w.busy = true;
      try {
        const night = groupNights(await fetchGuildReports(g, 1)).find((n) => n.live) ?? null;
        if (!wcl.current) return;
        if (!night) {
          setStatus((s) => ({ ...s, state: 'watching', file: null, message: messagesOf(liveMsg).waiting(g.name) }));
          return;
        }
        const pulls = uniquePulls(night.reports).length;
        const who = [...new Set(night.reports.map((r) => r.owner).filter(Boolean))].join(', ');
        if (night.path === w.path && pulls === w.pulls) {
          setStatus((s) => ({ ...s, state: 'watching', file: night.path, message: messagesOf(liveMsg).liveReport(who) }));
          return;
        }
        setStatus((s) => ({ ...s, state: 'analyzing', file: night.path, message: messagesOf(liveMsg).liveReport(who) }));
        const r = await analyzeLog(night.path, deathCutoff, () => {});
        if (!wcl.current) return;
        w.path = night.path;
        w.pulls = pulls;
        setStatus((s) => ({ ...s, state: 'watching', analyzed: r.pulls.length }));
        deliver(r);
      } catch (e) {
        setStatus((s) => ({ ...s, state: 'error', message: String(e) }));
      } finally {
        w.busy = false;
      }
    },
    [deliver],
  );

  /** `local`: o WoW abriu neste PC — segue o log dele, mesmo que o arquivo da noite ainda não exista. */
  const start = useCallback(
    async (deathCutoff: number, opts?: { local?: boolean }) => {
      setError(null);
      seen.current = null;
      if (wcl.current) window.clearInterval(wcl.current.timer);
      wcl.current = null;
      try {
        // log do WoW sendo escrito neste PC? então é ele (mais rápido que o upload ao vivo)
        const recentLocal = await logsList()
          .then((s) => s.files.some((f) => Date.now() - f.modifiedMs < LIVE_MS))
          .catch(() => false);
        if (opts?.local || recentLocal || !guild) {
          setStatus(await liveStart(null, deathCutoff));
          return;
        }
        await liveStop().catch(() => {});
        wcl.current = { timer: 0, path: null, pulls: 0, busy: false };
        setStatus({ active: true, state: 'watching', file: null, encounter: null, analyzed: 0, message: messagesOf(liveMsg).searching(guild.name) });
        void wclTick(guild, deathCutoff);
        wcl.current.timer = window.setInterval(() => void wclTick(guild, deathCutoff), WCL_POLL_MS);
      } catch (e) {
        setError(String(e));
      }
    },
    [guild, wclTick],
  );

  const stop = useCallback(async () => {
    if (wcl.current) {
      window.clearInterval(wcl.current.timer);
      wcl.current = null;
    } else {
      await liveStop();
    }
    setStatus(OFF);
  }, []);

  return { status, error, start, stop };
}
