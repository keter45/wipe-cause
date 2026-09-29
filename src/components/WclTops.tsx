import { useEffect, useState } from 'react';
import { ExternalLink, Settings2, Trophy } from 'lucide-react';
import type { Pull } from '../types';
import { inTauri, openExternal } from '../lib/api';
import { shortName } from '../lib/format';
import { fetchRankings, ownFight, pickTops, wclFightUrl, wowAnalyzerUrl, type TopRanking } from '../lib/wclApi';
import { useSetup } from '../lib/setup';
import type { Sample } from '../lib/performance';

/**
 * Busca dos tops da spec, automática quando o client da API já está salvo (os rankings ficam em
 * cache por dia). Sem client, leva à página de Configurações.
 */
export function WclTopsButton({ me, onTops }: { me: Sample; onTops: (tops: TopRanking[]) => void }) {
  const { status, openSettings } = useSetup();
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

  if (!inTauri) return <p className="muted small">Comparar com os top players do Warcraft Logs funciona no app instalado.</p>;
  if (!status) return null;
  if (!configured)
    return (
      <div className="panel setup-cta">
        <Trophy size={20} strokeWidth={1.5} className="muted" aria-hidden />
        <div>
          <h3>Compare com os top players da spec</h3>
          <p className="muted small">Conecte o Warcraft Logs (grátis, uma vez só) para ver a rotação, os cooldowns e o setup de quem tem o melhor parse neste boss.</p>
        </div>
        <button className="btn primary" onClick={() => openSettings('wcl')}>
          <Settings2 size={14} strokeWidth={1.5} aria-hidden /> Conectar
        </button>
      </div>
    );

  async function search() {
    setBusy(true);
    setMsg(null);
    try {
      const all = await fetchRankings(me.pull, me.player.specId!, me.player.role === 'healer');
      const tops = pickTops(all, me.player.setup?.itemLevel ?? null, me.pull.success ? me.pull.durationMs : null);
      if (tops.length === 0) setMsg('Nenhum parse desta spec neste boss e dificuldade no Warcraft Logs ainda.');
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
          <Trophy size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> Buscando os tops da spec no Warcraft Logs…
        </span>
      ) : (
        <button className="link small" onClick={search}>
          buscar de novo
        </button>
      )}
      <button className="link small" onClick={() => openSettings('wcl')}>
        trocar client
      </button>
      {msg && <p className="small bad">{msg}</p>}
    </div>
  );
}

/** Links do fight: do top (WCL + WoWAnalyzer) e do próprio pull, se o report estiver no WCL. */
export function PerfLinks({ pull, me, top, wclCode }: { pull: Pull; me: Sample; top?: { code: string; fightId: number; actorId: number; name: string } | null; wclCode?: string }) {
  const [own, setOwn] = useState<{ fightId: number; actorId: number | null } | null>(null);
  const configured = !!useSetup().status?.wcl?.configured;
  const myName = shortName(me.player.name);

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

  if (!top && !own) return null;
  return (
    <p className="perf-links small">
      {own && wclCode && (
        <>
          <span className="muted">Você:</span>
          {own.actorId != null && (
            <button className="link" onClick={() => openExternal(wclFightUrl({ code: wclCode, fightId: own.fightId, actorId: own.actorId! }))}>
              Warcraft Logs <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </button>
          )}
          <button className="link" onClick={() => openExternal(wowAnalyzerUrl({ code: wclCode, fightId: own.fightId, name: myName }))}>
            WoWAnalyzer <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>
        </>
      )}
      {top && (
        <>
          <span className="muted">Referência ({top.name}):</span>
          <button className="link" onClick={() => openExternal(wclFightUrl(top))}>
            Warcraft Logs <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>
          <button className="link" onClick={() => openExternal(wowAnalyzerUrl(top))}>
            WoWAnalyzer <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>
        </>
      )}
    </p>
  );
}
