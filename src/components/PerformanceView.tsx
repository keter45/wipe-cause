import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GearItem, PlayerStats, Pull } from '../types';
import { mmss, num, shortName } from '../lib/format';
import {
  SECONDARY,
  SLOT_NAMES,
  CD_LATE_MS,
  candidates,
  combatPotions,
  compareCooldowns,
  compareItems,
  compareRotation,
  defaultReference,
  detectCooldowns,
  isHealer,
  outputPerSec,
  perfInsights,
  statSplit,
  talentDiff,
  totalCpm,
  type CooldownRow,
  type Sample,
} from '../lib/performance';
import { specLabel } from '../lib/specs';
import { useTalentTree, type TalentTree } from '../lib/talents';
import { useTooltip } from '../lib/wowhead';
import { SpellIcon, SpellName } from './SpellIcon';

const PLAYER_KEY = 'wipe-cause:perf-player';

function rememberedPlayer(): string | null {
  try {
    return localStorage.getItem(PLAYER_KEY);
  } catch {
    return null;
  }
}
function rememberPlayer(name: string) {
  try {
    localStorage.setItem(PLAYER_KEY, name);
  } catch {
    /* sem storage */
  }
}

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const;
const sampleKey = (s: Sample) => `${s.pull.id}:${s.player.guid}`;

/** "Fulano · pull 14" / "você no pull 14" */
function refLabel(me: Sample, s: Sample): string {
  const who = s.player.guid === me.player.guid ? 'Você' : shortName(s.player.name);
  const where = s.pull.id === me.pull.id ? 'neste pull' : `pull ${s.pull.pullNumber}${s.pull.success ? ' (kill)' : ''}`;
  return `${who} · ${where}`;
}

const signedSec = (ms: number) => `${ms > 0 ? '+' : '−'}${Math.round(Math.abs(ms) / 1000)}s`;

/** Comparação de desempenho com a mesma spec na noite (etapa 1: sem dados externos). */
export function PerformanceView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const players = useMemo(
    () =>
      [...pull.players]
        .filter((p) => p.specId != null)
        .sort((a, b) => ROLE_ORDER[a.role ?? 'dps'] - ROLE_ORDER[b.role ?? 'dps'] || a.name.localeCompare(b.name)),
    [pull],
  );
  const [guid, setGuid] = useState<string | null>(null);
  const player =
    players.find((p) => p.guid === guid) ?? players.find((p) => p.name === rememberedPlayer()) ?? players.find((p) => p.role === 'dps') ?? players[0];

  if (!player) return <p className="muted pad">Sem dados de spec dos jogadores neste pull.</p>;
  if (!player.casts) return <p className="muted pad">Esta análise é de uma versão antiga do app. Analise o log de novo para ver o desempenho.</p>;

  return (
    <div className="perf">
      <label className="perf-field">
        <span className="muted small">Jogador</span>
        <select
          className="select"
          value={player.guid}
          onChange={(e) => {
            setGuid(e.target.value);
            const p = players.find((x) => x.guid === e.target.value);
            if (p) rememberPlayer(p.name);
          }}
        >
          {players.map((p) => (
            <option key={p.guid} value={p.guid}>
              {shortName(p.name)} — {specLabel(p.specId)}
            </option>
          ))}
        </select>
      </label>
      <Comparison key={player.guid} me={{ pull, player }} nightPulls={nightPulls} />
    </div>
  );
}

function Comparison({ me, nightPulls }: { me: Sample; nightPulls: Pull[] }) {
  const list = useMemo(() => candidates(me, nightPulls), [me, nightPulls]);
  const [refKey, setRefKey] = useState<string | null>(null);
  const ref = list.find((s) => sampleKey(s) === refKey) ?? defaultReference(me, list);
  const cds = useMemo(() => detectCooldowns([me, ...list]), [me, list]);

  if (!ref)
    return (
      <p className="muted pad">
        Ninguém mais jogou de {specLabel(me.player.specId)} neste boss na noite (nem você em outro pull com 30s+ vivo). A comparação com os top
        players do Warcraft Logs vem na próxima etapa.
      </p>
    );

  const healer = isHealer(me.player);
  const [mo, ro] = [outputPerSec(me), outputPerSec(ref)];
  const diff = ro > 0 ? ((mo - ro) / ro) * 100 : 0;
  const insights = perfInsights(me, ref, cds);

  return (
    <>
      <label className="perf-field">
        <span className="muted small">Comparar com</span>
        <select className="select" value={sampleKey(ref)} onChange={(e) => setRefKey(e.target.value)}>
          {list.map((s) => (
            <option key={sampleKey(s)} value={sampleKey(s)}>
              {refLabel(me, s)} — {num(outputPerSec(s))} {healer ? 'HPS' : 'DPS'} vivo
            </option>
          ))}
        </select>
      </label>
      <p className="muted small perf-note">
        Mesma spec, no mesmo boss e dificuldade. Tudo é por minuto vivo e os cooldowns são comparados só no tempo em que os dois estavam vivos, então
        dá para comparar wipes de durações diferentes.
      </p>

      <div className="death-stats perf-stats">
        <Stat label={`${healer ? 'Cura' : 'Dano'} por segundo vivo`} mine={num(mo)} ref={num(ro)} tone={diff <= -15 ? 'bad' : diff < -3 ? 'warn' : ''} extra={ro > 0 ? `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%` : undefined} />
        <Stat label="Tempo vivo" mine={mmss(me.player.aliveMs ?? 0)} ref={mmss(ref.player.aliveMs ?? 0)} />
        <Stat label="Casts por minuto" mine={totalCpm(me).toFixed(1)} ref={totalCpm(ref).toFixed(1)} />
        <Stat label="Item level" mine={me.player.setup?.itemLevel.toFixed(1) ?? '—'} ref={ref.player.setup?.itemLevel.toFixed(1) ?? '—'} />
      </div>

      {insights.length > 0 && (
        <section className="perf-section">
          <h4>Pontos principais</h4>
          <ul className="perf-insights">
            {insights.map((i, k) => (
              <li key={k} className={`tone-${i.tone}`}>
                {i.spellId != null && <SpellIcon spellId={i.spellId} size={16} />}
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Cooldowns me={me} ref_={ref} cds={cds} />
      <Rotation me={me} ref_={ref} cds={cds} />
      <Potions me={me} ref_={ref} />
      <SetupView me={me.player} ref_={ref.player} />
    </>
  );
}

function Stat({ label, mine, ref, tone = '', extra }: { label: string; mine: string; ref: string; tone?: string; extra?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className={tone}>
        {mine} {extra && <span className="small">({extra})</span>}
      </strong>
      <span className="muted small">referência: {ref}</span>
    </div>
  );
}

// ---- cooldowns

function Cooldowns({ me, ref_, cds }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns> }) {
  const { windowMs, rows } = compareCooldowns(me, ref_, cds);
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const core = rows.filter((r) => r.core);
  const shown = showAll || core.length === 0 ? rows : core;
  return (
    <section className="perf-section">
      <h4>
        Cooldowns <span className="muted small">de 0:00 a {mmss(windowMs)} (os dois vivos)</span>
      </h4>
      <div className="cd-legend small">
        <span className="cd-dot mine" /> você <span className="cd-dot ref" /> referência
      </div>
      <div className="cd-rows">
        {shown.map((r) => (
          <CooldownLine key={r.spellId} r={r} windowMs={windowMs} />
        ))}
      </div>
      {core.length > 0 && core.length < rows.length && (
        <button className="link small more-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showAll ? 'open' : ''}`} aria-hidden />
          {showAll ? 'Só os principais' : `Mostrar ${rows.length - core.length} de uso ocasional`}
        </button>
      )}
    </section>
  );
}

function CooldownLine({ r, windowMs }: { r: CooldownRow; windowMs: number }) {
  const at = (t: number) => `${Math.min(100, (t / windowMs) * 100)}%`;
  const fewer = r.core && r.mine.length < r.ref.length;
  const late = r.core && r.firstDelta != null && Math.abs(r.firstDelta) > CD_LATE_MS;
  return (
    <div className="cd-row">
      <SpellName spellId={r.spellId} name={r.name} size={16} />
      <div className="cd-track" role="img" aria-label={`Você: ${r.mine.map(mmss).join(', ') || 'não usou'}. Referência: ${r.ref.map(mmss).join(', ') || 'não usou'}.`}>
        <div className="cd-lane">
          {r.mine.map((t, i) => (
            <span key={i} className="cd-mark mine" style={{ left: at(t) }} title={`Você: ${mmss(t)}`} />
          ))}
        </div>
        <div className="cd-lane">
          {r.ref.map((t, i) => (
            <span key={i} className="cd-mark ref" style={{ left: at(t) }} title={`Referência: ${mmss(t)}`} />
          ))}
        </div>
      </div>
      <span className={`cd-count num small ${fewer ? 'bad' : ''}`} title={r.possible ? `cabem ~${r.possible} usos no tempo (pelo intervalo visto)` : undefined}>
        {r.mine.length} × {r.ref.length}
      </span>
      <span className={`cd-delta num small ${late ? 'warn' : 'muted'}`} title="1º uso: você em relação à referência">
        {r.firstDelta != null ? `1º ${signedSec(r.firstDelta)}` : ''}
      </span>
    </div>
  );
}

// ---- rotação

function Rotation({ me, ref_, cds }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns> }) {
  const rows = compareRotation(me, ref_, cds);
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const core = rows.filter((r) => r.core);
  const shown = showAll ? rows : core;
  const what = isHealer(me.player) ? 'cura' : 'dano';
  const FLAG = { missing: 'não usou', low: 'abaixo', high: 'acima', extra: 'só você' } as const;
  return (
    <section className="perf-section">
      <h4>Rotação</h4>
      <div className="table-scroll">
        <table className="perf-table">
          <thead>
            <tr>
              <th>Habilidade</th>
              <th className="num">Você /min</th>
              <th className="num">Ref. /min</th>
              <th className="num">% do {what} (você)</th>
              <th className="num">% (ref.)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.spellId}>
                <td>
                  <SpellName spellId={r.spellId} name={r.name} size={16} />
                </td>
                <td className="num">{r.mineCpm.toFixed(1)}</td>
                <td className="num muted">{r.refCpm.toFixed(1)}</td>
                <td className="num">{r.mineShare != null ? `${r.mineShare.toFixed(1)}%` : '—'}</td>
                <td className="num muted">{r.refShare != null ? `${r.refShare.toFixed(1)}%` : '—'}</td>
                <td className={`small ${r.flag === 'missing' || r.flag === 'low' ? 'warn' : 'muted'}`}>{r.flag ? FLAG[r.flag] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {core.length < rows.length && (
        <button className="link small more-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showAll ? 'open' : ''}`} aria-hidden />
          {showAll ? 'Só a rotação' : `Mostrar ${rows.length - core.length} utilitária${rows.length - core.length > 1 ? 's' : ''} (movimento, buffs)`}
        </button>
      )}
    </section>
  );
}

// ---- poções

function Potions({ me, ref_ }: { me: Sample; ref_: Sample }) {
  const [mine, ref] = [combatPotions(me), combatPotions(ref_)];
  if (mine.length === 0 && ref.length === 0) return null;
  const line = (list: ReturnType<typeof combatPotions>) =>
    list.length === 0 ? (
      <span className="muted">nenhuma</span>
    ) : (
      list.map((c) => (
        <span key={c.spellId} className="perf-potion">
          <SpellName spellId={c.spellId} name={c.name} size={16} /> <span className="muted small">{c.times.map(mmss).join(', ')}</span>
        </span>
      ))
    );
  return (
    <section className="perf-section">
      <h4>Poção de combate</h4>
      <p className={`perf-line ${mine.length === 0 ? 'warn' : ''}`}>
        <span className="muted small perf-who">Você</span> {line(mine)}
      </p>
      <p className="perf-line">
        <span className="muted small perf-who">Referência</span> {line(ref)}
      </p>
    </section>
  );
}

// ---- setup

function SetupView({ me, ref_ }: { me: PlayerStats; ref_: PlayerStats }) {
  const { tree, error } = useTalentTree(me.specId);
  const [ms, rs] = [me.setup, ref_.setup];
  if (!ms || !rs) return null;
  const same = me.guid === ref_.guid;
  const [mSplit, rSplit] = [statSplit(ms.stats), statSplit(rs.stats)];
  const talents = talentDiff(ms.talents, rs.talents);
  const items = compareItems(ms.items, rs.items);
  return (
    <section className="perf-section">
      <h4>Setup</h4>
      <div className="perf-setup">
        <div>
          <h5 className="muted small">Distribuição de status secundários</h5>
          <table className="perf-table">
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Você</th>
                <th className="num">Ref.</th>
              </tr>
            </thead>
            <tbody>
              {SECONDARY.map((s) => {
                const d = mSplit[s.key] - rSplit[s.key];
                return (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className={`num ${Math.abs(d) >= 8 ? 'warn' : ''}`}>
                      {mSplit[s.key].toFixed(0)}% <span className="muted small">({num(ms.stats[s.key])})</span>
                    </td>
                    <td className="num muted">
                      {rSplit[s.key].toFixed(0)}% <span className="small">({num(rs.stats[s.key])})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <h5 className="muted small">Talentos {same && '(você mesmo em outro pull)'}</h5>
          {talents.onlyMine.length === 0 && talents.onlyRef.length === 0 && talents.rank.length === 0 ? (
            <p className="muted small">Mesmos talentos.</p>
          ) : (
            <div className="talent-diff">
              <TalentList title="Só você" list={talents.onlyMine} tree={tree} />
              <TalentList title="Só a referência" list={talents.onlyRef} tree={tree} />
            </div>
          )}
          {talents.rank.length > 0 && (
            <ul className="plain talent-list">
              <li className="muted small">Pontos diferentes (você → referência)</li>
              {talents.rank.map(([m, r]) => {
                const t = tree?.get(m[1]);
                return (
                  <li key={m[1]}>
                    {t ? <SpellName spellId={t.spellId} icon={t.icon} name={t.name} size={16} /> : <span className="muted">talento {m[1]}</span>}
                    <span className="small">
                      {m[2]} → {r[2]}
                      {t ? `/${t.maxRanks}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="muted small">Sem os nomes dos talentos agora ({error}).</p>}
        </div>
      </div>
      <h5 className="muted small">Itens</h5>
      <div className="table-scroll">
        <table className="perf-table items">
          <thead>
            <tr>
              <th>Espaço</th>
              <th>Você</th>
              <th>Referência</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.slot} className={r.mine?.itemId !== r.ref?.itemId ? 'diff' : ''}>
                <td className="muted small">{SLOT_NAMES[r.slot]}</td>
                <td>
                  <ItemCell item={r.mine} missingEnchant={r.missingEnchant} missingGems={r.missingGems} />
                </td>
                <td>
                  <ItemCell item={r.ref} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TalentList({ title, list, tree }: { title: string; list: [number, number, number][]; tree: TalentTree | null }) {
  return (
    <div>
      <span className="muted small">{title}</span>
      {list.length === 0 ? (
        <p className="muted small">—</p>
      ) : (
        <ul className="plain talent-list">
          {list.map(([node, entry, rank]) => {
            const t = tree?.get(entry);
            return (
              <li key={`${node}:${entry}`}>
                {t ? <SpellName spellId={t.spellId} icon={t.icon} name={t.name} size={16} /> : <span className="muted">talento {entry}</span>}
                {t && t.maxRanks > 1 && <span className="muted small"> {rank}/{t.maxRanks}</span>}
                {t?.tree === 'hero' && <span className="chip mech">herói</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemCell({ item, missingEnchant, missingGems }: { item: GearItem | null; missingEnchant?: boolean; missingGems?: number }) {
  const tip = useTooltip(item?.itemId ?? -1, !!item, 'item');
  if (!item) return <span className="muted">—</span>;
  return (
    <span className="item-cell">
      <SpellIcon spellId={item.itemId} kind="item" size={18} />
      <span className={`item-name q${tip?.quality ?? ''}`}>{tip?.name ?? `item ${item.itemId}`}</span>
      <span className="muted small">{item.ilvl}</span>
      {item.enchant && <span className="chip mech" title={`Encantamento ${item.enchant}`}>enc.</span>}
      {item.gems.length > 0 && <span className="chip mech">{item.gems.length} gema{item.gems.length > 1 ? 's' : ''}</span>}
      {missingEnchant && <span className="chip">sem encantamento</span>}
      {!!missingGems && <span className="chip">−{missingGems} gema{missingGems > 1 ? 's' : ''}</span>}
    </span>
  );
}
