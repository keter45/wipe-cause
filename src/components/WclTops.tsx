import { useEffect, useState } from 'react';
import { ExternalLink, Settings2, Trophy } from 'lucide-react';
import type { Pull } from '../types';
import { hasBackend, openExternal } from '../lib/api';
import { shortName } from '../lib/format';
import { fetchRankings, healerCompCandidates, ownFight, pickTops, TOPS_SHOWN, withoutExternalPI, profileUrls, wclCompareUrl, wclRangeUrl, wowAnalyzerUrl, type TopRanking, type WclFightRef, type WclView } from '../lib/wclApi';
import { useSetup } from '../lib/setup';
import { pullHealers } from '../lib/healer';
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
  /** resultado da busca de healer (quantos logs passaram no filtro de composição) */
  const [info, setInfo] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (hasBackend && configured && !searched) {
      setSearched(true);
      void search();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasBackend) return <p className="muted small">{t.appOnly}</p>;
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

  // healer: kills de outras guildas com composição de healers parecida (nunca os tops nem a nossa raid)
  const healer = me.player.role === 'healer';
  async function search() {
    setBusy(true);
    setMsg(null);
    setInfo(null);
    try {
      if (healer) {
        const ours = pullHealers(me.pull);
        const { list, checked } = await healerCompCandidates(me.pull, me.player.specId!, ours);
        setInfo(list.length ? t.compFound(list.length, checked, ours.join(', ')) : t.compNone(checked));
        onTops(list);
        return;
      }
      const all = await fetchRankings(me.pull, me.player.specId!, false);
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
          <Trophy size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {healer ? t.compSearching : t.searching}
        </span>
      ) : (
        <button className="link small" onClick={search}>
          {t.searchAgain}
        </button>
      )}
      <button className="link small" onClick={() => openSettings('wcl')}>
        {t.changeClient}
      </button>
      {info && <p className="small muted">{info}</p>}
      {msg && <p className="small bad">{msg}</p>}
    </div>
  );
}

/**
 * Um player de um pull da noite no report do WCL (se o link da noite estiver cadastrado e o client
 * configurado): para os links do fight dele. Sem `wclCode` (ou sem achar o player), null.
 */
export function useWclFight(pull: Pull, playerName: string, wclCode?: string): WclFightRef | null {
  const [found, setFound] = useState<WclFightRef | null>(null);
  const configured = !!useSetup().status?.wcl?.configured;
  const name = shortName(playerName);
  useEffect(() => {
    setFound(null);
    if (!hasBackend || !wclCode || !name) return;
    let alive = true;
    Promise.resolve(configured ? ownFight(wclCode, pull) : null)
      .then((f) => {
        const actor = f?.actors.find((a) => a.name === name);
        if (alive && f && actor) setFound({ code: wclCode, fightId: f.fightId, actorId: actor.id, fightStart: f.fightStart, name });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wclCode, pull, name, configured]);
  return found;
}

export interface PerfLink {
  /** de quem é o link; 'both' = a comparação dos dois no Warcraft Logs */
  who: 'you' | 'ref' | 'both' | 'profile';
  label: string;
  url: string;
}

/**
 * Links do fight: o seu (se o report da noite estiver no WCL), o da referência (top ou alguém da raid)
 * e, com os dois, a comparação lado a lado no próprio Warcraft Logs.
 */
export function perfLinks(
  you: WclFightRef | null,
  ref: WclFightRef | null,
  type: WclView = 'damage-done',
  /** top do Warcraft Logs: o perfil dele no Raider.IO e no Warcraft Logs */
  profile?: { name: string; server: string; region: string } | null,
): PerfLink[] {
  const out: PerfLink[] = [];
  if (you) {
    out.push({ who: 'you', label: 'Warcraft Logs', url: wclRangeUrl(you, type) });
    out.push({ who: 'you', label: 'WoWAnalyzer', url: wowAnalyzerUrl(you) });
  }
  if (ref) {
    out.push({ who: 'ref', label: `Warcraft Logs (${ref.name})`, url: wclRangeUrl(ref, type) });
    out.push({ who: 'ref', label: `WoWAnalyzer (${ref.name})`, url: wowAnalyzerUrl(ref) });
  }
  if (you && ref) out.push({ who: 'both', label: 'Warcraft Logs', url: wclCompareUrl(you, ref, type) });
  if (profile) {
    const t = messagesOf(wclTopsMsg);
    for (const p of profileUrls(profile)) out.push({ who: 'profile', label: t.site[p.site](profile.name), url: p.url });
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
