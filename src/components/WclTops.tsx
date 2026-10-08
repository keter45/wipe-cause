import { useEffect, useState } from 'react';
import { ExternalLink, Settings2, Trophy } from 'lucide-react';
import type { Pull } from '../types';
import { inTauri, openExternal } from '../lib/api';
import { shortName } from '../lib/format';
import { fetchRankings, ownFight, pickTops, TOPS_SHOWN, withoutExternalPI, wclFightUrl, wowAnalyzerUrl, type TopRanking } from '../lib/wclApi';
import { useSetup } from '../lib/setup';
import type { Sample } from '../lib/performance';
import { messagesOf, useMessages } from '../i18n';
import { wclTopsMsg } from './WclTops.i18n';

/**
 * Busca dos tops da spec, automática quando o client da API já está salvo (os rankings ficam em
 * cache por dia). Sem client, leva à página de Configurações.
 */
export function WclTopsButton({ me, onTops }: { me: Sample; onTops: (tops: TopRanking[]) => void }) {
  const { status, openSettings } = useSetup();
  const t = useMessages(wclTopsMsg);
  const configured = !!status?.wcl?.configured;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (inTauri && configured && !searched) {
      setSearched(true);
      void search();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inTauri) return <p className="muted small">{t.appOnly}</p>;
  if (!status) return null;
  if (!configured)
    return (
      <div className="panel setup-cta">
        <Trophy size={20} strokeWidth={1.5} className="muted" aria-hidden />
        <div>
          <h3>{t.ctaTitle}</h3>
          <p className="muted small">{t.ctaText}</p>
        </div>
        <button className="btn primary" onClick={() => openSettings('wcl')}>
          <Settings2 size={14} strokeWidth={1.5} aria-hidden /> {t.connect}
        </button>
      </div>
    );

  async function search() {
    setBusy(true);
    setMsg(null);
    try {
      const all = await fetchRankings(me.pull, me.player.specId!, me.player.role === 'healer');
      // o dobro de candidatos: os que receberam Power Infusion de outra pessoa saem
      const tops = await withoutExternalPI(pickTops(all, me.player.setup?.itemLevel ?? null, me.pull.success ? me.pull.durationMs : null, TOPS_SHOWN * 2), TOPS_SHOWN);
      if (tops.length === 0) setMsg(t.noParses);
      onTops(tops);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wcl-tops">
      {busy ? (
        <span className="muted small">
          <Trophy size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {t.searching}
        </span>
      ) : (
        <button className="link small" onClick={search}>
          {t.searchAgain}
        </button>
      )}
      <button className="link small" onClick={() => openSettings('wcl')}>
        {t.changeClient}
      </button>
      {msg && <p className="small bad">{msg}</p>}
    </div>
  );
}

export interface OwnFightRef {
  fightId: number;
  actorId: number | null;
}

/** O fight deste pull no report do WCL (se o link da noite estiver cadastrado e o client configurado). */
export function useOwnFight(pull: Pull, playerName: string, wclCode?: string): OwnFightRef | null {
  const [own, setOwn] = useState<OwnFightRef | null>(null);
  const configured = !!useSetup().status?.wcl?.configured;
  const myName = shortName(playerName);
  useEffect(() => {
    setOwn(null);
    if (!inTauri || !wclCode) return;
    let alive = true;
    Promise.resolve(configured ? ownFight(wclCode, pull) : null)
      .then((f) => alive && f && setOwn({ fightId: f.fightId, actorId: f.actors.find((a) => a.name === myName)?.id ?? null }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wclCode, pull, myName, configured]);
  return own;
}

export interface PerfLink {
  who: 'you' | 'ref';
  label: string;
  url: string;
}

/** Links do fight: do próprio pull (se o report estiver no WCL) e do top. */
export function perfLinks(
  playerName: string,
  own: OwnFightRef | null,
  wclCode: string | undefined,
  top: { code: string; fightId: number; actorId: number; name: string } | null | undefined,
): PerfLink[] {
  const out: PerfLink[] = [];
  const myName = shortName(playerName);
  if (own && wclCode) {
    if (own.actorId != null) out.push({ who: 'you', label: 'Warcraft Logs', url: wclFightUrl({ code: wclCode, fightId: own.fightId, actorId: own.actorId }) });
    out.push({ who: 'you', label: 'WoWAnalyzer', url: wowAnalyzerUrl({ code: wclCode, fightId: own.fightId, name: myName }) });
  }
  if (top) {
    out.push({ who: 'ref', label: `Warcraft Logs (${top.name})`, url: wclFightUrl(top) });
    out.push({ who: 'ref', label: `WoWAnalyzer (${top.name})`, url: wowAnalyzerUrl(top) });
  }
  return out;
}

/** Links na tela (abrem no navegador padrão). */
export function PerfLinks({ links }: { links: PerfLink[] }) {
  if (links.length === 0) return null;
  return (
    <p className="perf-links small">
      {links.map((l, i) => (
        <span key={l.url}>
          {(i === 0 || links[i - 1].who !== l.who) && <span className="muted">{messagesOf(wclTopsMsg).who[l.who]}: </span>}
          <button className="link" onClick={() => openExternal(l.url)}>
            {l.label} <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>
        </span>
      ))}
    </p>
  );
}
