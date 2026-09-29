import { useEffect, useState } from 'react';
import { ExternalLink, Trophy } from 'lucide-react';
import type { Pull } from '../types';
import { inTauri, openExternal } from '../lib/api';
import { shortName } from '../lib/format';
import { fetchRankings, ownFight, pickTops, wclFightUrl, wclGetConfig, wclSetConfig, wowAnalyzerUrl, type TopRanking, type WclConfig } from '../lib/wclApi';
import type { Sample } from '../lib/performance';

const CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients/';

/**
 * Configuração do client da API (uma vez) e busca dos tops da spec, automática quando o client
 * já está salvo (os rankings ficam em cache por dia).
 */
export function WclTopsButton({ me, onTops }: { me: Sample; onTops: (tops: TopRanking[]) => void }) {
  const [config, setConfig] = useState<WclConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (inTauri) wclGetConfig().then(setConfig).catch(() => setConfig({ configured: false, clientId: null }));
  }, []);

  useEffect(() => {
    if (config?.configured && !editing && !searched) {
      setSearched(true);
      void search();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inTauri) return <p className="muted small">Comparar com os top players do Warcraft Logs funciona no app instalado.</p>;
  if (!config) return null;
  if (!config.configured || editing)
    return (
      <WclSetup
        clientId={config.clientId}
        onCancel={config.configured ? () => setEditing(false) : undefined}
        onSaved={() => {
          setEditing(false);
          setSearched(false);
          wclGetConfig().then(setConfig);
        }}
      />
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
      <button className="link small" onClick={() => setEditing(true)}>
        trocar client
      </button>
      {msg && <p className="small bad">{msg}</p>}
    </div>
  );
}

function WclSetup({ clientId, onSaved, onCancel }: { clientId: string | null; onSaved: () => void; onCancel?: () => void }) {
  const [id, setId] = useState(clientId ?? '');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await wclSetConfig(id, secret);
      onSaved();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel wcl-setup">
      <h4>
        <Trophy size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> Conectar ao Warcraft Logs
      </h4>
      <ol className="small wcl-steps">
        <li>
          Entre em{' '}
          <button type="button" className="link" onClick={() => openExternal(CLIENTS_URL)}>
            warcraftlogs.com/api/clients <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
          </button>{' '}
          e clique em <em>Create Client</em>.
        </li>
        <li>
          Qualquer nome; em <em>Redirect URL</em> use <code>http://localhost</code>. Deixe <em>Public Client</em> desmarcado.
        </li>
        <li>Copie o client ID e o client secret para cá.</li>
      </ol>
      <p className="muted small">
        É grátis. O secret fica no cofre de credenciais do Windows e as consultas só enviam boss, spec e código de report: nada do seu log sai do PC.
      </p>
      <label className="field">
        Client ID
        <input className="text-input" value={id} spellCheck={false} autoComplete="off" onChange={(e) => setId(e.target.value)} />
      </label>
      <label className="field">
        Client secret
        <input
          className="text-input"
          type="password"
          value={secret}
          spellCheck={false}
          autoComplete="off"
          placeholder={clientId ? '•••••••• (cole de novo para trocar)' : ''}
          onChange={(e) => setSecret(e.target.value)}
        />
      </label>
      {msg && <p className="small bad">{msg}</p>}
      <div className="dialog-actions">
        <span className="topbar-spacer" />
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn primary" onClick={save} disabled={busy || !id.trim() || !secret.trim()}>
          {busy ? 'Conferindo…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

/** Links do fight: do top (WCL + WoWAnalyzer) e do próprio pull, se o report estiver no WCL. */
export function PerfLinks({ pull, me, top, wclCode }: { pull: Pull; me: Sample; top?: { code: string; fightId: number; actorId: number; name: string } | null; wclCode?: string }) {
  const [own, setOwn] = useState<{ fightId: number; actorId: number | null } | null>(null);
  const myName = shortName(me.player.name);

  useEffect(() => {
    setOwn(null);
    if (!inTauri || !wclCode) return;
    let alive = true;
    wclGetConfig()
      .then((c) => (c.configured ? ownFight(wclCode, pull) : null))
      .then((f) => alive && f && setOwn({ fightId: f.fightId, actorId: f.actors.find((a) => a.name === myName)?.id ?? null }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wclCode, pull, myName]);

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
