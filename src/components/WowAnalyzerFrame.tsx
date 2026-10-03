import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppWindow, LoaderCircle } from 'lucide-react';
import { inTauri, openExternal } from '../lib/api';
import { wowAnalyzerUrl } from '../lib/wclApi';
import { shortName } from '../lib/format';
import { useSetup } from '../lib/setup';
import type { OwnFightRef } from './WclTops';

interface Props {
  playerName: string;
  /** report da noite no Warcraft Logs (o WoWAnalyzer lê o log de lá) */
  wclCode: string | undefined;
  /** o fight deste pull no report (null enquanto procura ou se não achou) */
  own: OwnFightRef | null;
  /** top player escolhido na comparação, para abrir a análise dele também */
  top: { code: string; fightId: number; name: string } | null;
  bossName: string;
}

/** Abre no WoWAnalyzer numa janela do app (no navegador, fora do app). */
async function open(url: string, title: string) {
  if (!inTauri) return openExternal(url);
  await invoke('wowanalyzer_open', { url, title });
}

/**
 * A análise do WoWAnalyzer (rotação, checklist, cooldowns) do pull aberto, numa janela do app:
 * dentro da página não dá, porque o site fica atrás da verificação do Cloudflare. O WoWAnalyzer
 * lê o log do Warcraft Logs, então o pull precisa estar num report.
 */
export function WowAnalyzerFrame({ playerName, wclCode, own, top, bossName }: Props) {
  const { status, openSettings } = useSetup();
  const [error, setError] = useState<string | null>(null);
  const myName = shortName(playerName);
  const mine = wclCode && own ? wowAnalyzerUrl({ code: wclCode, fightId: own.fightId, name: myName }) : null;
  const theirs = top ? wowAnalyzerUrl(top) : null;
  const go = (url: string, who: string) => open(url, `WoWAnalyzer — ${who} · ${bossName}`).catch((e) => setError(String(e)));

  if (!wclCode) {
    return (
      <div className="wowa-empty muted small">
        <p>O WoWAnalyzer lê o log do Warcraft Logs, então este pull precisa estar num report.</p>
        <p>
          {status?.wcl?.user ? (
            'Abra a noite em “Nova análise” pelo report da guilda, ou cole o link do report no botão Warcraft Logs do topo.'
          ) : (
            <>
              Cole o link do report da noite no botão Warcraft Logs do topo, ou{' '}
              <button className="link" onClick={() => openSettings('wcl')}>
                entre com o Warcraft Logs
              </button>{' '}
              para ver as noites da guilda.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <section className="wowa">
      <p className="muted small">
        O <strong>WoWAnalyzer</strong> analisa a rotação, o checklist da spec (uptime de buffs e DoTs, uso de cooldowns) e aponta os erros mais comuns —
        mantido por quem joga cada spec. Abre numa janela do Wipe Cause; na primeira vez o site pode pedir uma verificação rápida.
      </p>
      {!mine ? (
        <p className="muted small log-reading">
          <LoaderCircle size={13} strokeWidth={1.5} className="spin" aria-hidden /> Procurando este pull no report do Warcraft Logs… (wipes curtos não
          aparecem lá)
        </p>
      ) : (
        <div className="wowa-actions">
          <button className="btn primary" onClick={() => go(mine, myName)}>
            <AppWindow size={16} strokeWidth={1.5} aria-hidden /> Analisar você ({myName})
          </button>
          {theirs && top && (
            <button className="btn" onClick={() => go(theirs, top.name)} title="A análise do top player escolhido em Top players, para comparar">
              <AppWindow size={16} strokeWidth={1.5} aria-hidden /> Analisar a referência ({top.name})
            </button>
          )}
        </div>
      )}
      {error && <p className="small bad">{error}</p>}
    </section>
  );
}
