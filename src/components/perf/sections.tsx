// Seções da comparação de desempenho: a tela e o cartão de compartilhar usam as mesmas.

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GearItem, PlayerStats } from '../../types';
import { mmss, num } from '../../lib/format';
import { SECONDARY, SLOT_NAMES, BURST_LEAD_MS, BURST_WINDOW_MS, burstCandidates, burstWindows, combatPotions, compareItems, compareRotation, detectCooldowns, isHealer, statSplit, talentDiff, type BurstSide, type BurstWindow, type Sample } from '../../lib/performance';
import { specLabel } from '../../lib/specs';
import { useTalentTree, type TalentTree } from '../../lib/talents';
import { useTooltip } from '../../lib/wowhead';
import { SpellIcon, SpellName } from '../SpellIcon';
import { signedSec } from './CooldownCompare';


export function Stat({ label, mine, ref, tone = '', extra }: { label: string; mine: string; ref: string; tone?: string; extra?: string }) {
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

// ---- janelas de burst

export const burstKey = (w: BurstWindow) => `${w.name}#${w.index}`;

/** Cada uso de cooldown maior vira uma janela (chip); dentro, a sequência de casts lado a lado. */
const PICK_KEY = 'wipe-cause:burst-cds:';

/** Cooldowns escolhidos para abrir janela, por spec (null = ainda não escolheu: usa os marcados de início). */
export function loadBurstPick(specId: number | null): Set<string> | null {
  try {
    const raw = specId != null ? localStorage.getItem(PICK_KEY + specId) : null;
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function saveBurstPick(specId: number | null, names: Set<string>) {
  try {
    if (specId != null) localStorage.setItem(PICK_KEY + specId, JSON.stringify([...names]));
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}

export function Bursts({ me, ref_, cds }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns> }) {
  const specId = me.player.specId;
  const candidates = useMemo(() => burstCandidates(me, ref_, cds), [me, ref_, cds]);
  const [pick, setPick] = useState<Set<string> | null>(() => loadBurstPick(specId));
  const chosen = pick ?? new Set(candidates.filter((c) => c.preset).map((c) => c.name));
  const windows = useMemo(() => burstWindows(me, ref_, cds, chosen), [me, ref_, cds, [...chosen].join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<string | null>(null);
  if (candidates.length === 0) return null;
  const w = windows.find((x) => burstKey(x) === sel) ?? windows[0];
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPick(next);
    saveBurstPick(specId, next);
  };
  return (
    <section className="perf-section">
      <h4>
        Janelas de burst <span className="muted small">sequência de casts de {BURST_LEAD_MS / 1000}s antes a {BURST_WINDOW_MS / 1000}s depois de cada uso</span>
      </h4>
      <div className="burst-pick">
        <span className="muted small">Cooldowns para comparar ({specLabel(specId)}):</span>
        <div className="chips">
          {candidates.map((c) => {
            const on = chosen.has(c.name);
            return (
              <button key={c.name} aria-pressed={on} className={on ? 'active' : ''} onClick={() => toggle(c.name)}>
                <SpellIcon spellId={c.spellId} size={14} /> {c.name}
              </button>
            );
          })}
        </div>
      </div>
      {windows.length === 0 ? (
        <p className="muted small">Marque acima os cooldowns que abrem uma janela de burst.</p>
      ) : (
        <>
      <div className="chips burst-chips" role="radiogroup" aria-label="Janela de burst">
        {windows.map((x) => {
          const k = burstKey(x);
          const active = burstKey(w) === k;
          return (
            <button key={k} role="radio" aria-checked={active} className={`${active ? 'active' : ''} ${!x.mine ? 'missing' : ''}`} onClick={() => setSel(k)}>
              <SpellIcon spellId={x.spellId} size={16} /> {x.name} {x.index}
              <span className="muted"> {x.mine ? mmss(x.mine.start) : 'não usou'}</span>
            </button>
          );
        })}
      </div>
      <BurstCompare w={w} />
        </>
      )}
    </section>
  );
}

/** Posição (%) na janela de −3s a +20s. */
const burstPos = (dt: number) => ((dt + BURST_LEAD_MS) / (BURST_LEAD_MS + BURST_WINDOW_MS)) * 100;
/** Ícones mais perto que isto (em % da largura) vão para a linha de baixo. */
const ICON_GAP_PCT = 3.6;
const BURST_TICKS = [0, 5_000, 10_000, 15_000, 20_000];

/** Casts da janela no tempo, como a linha do tempo dos cooldowns: você em cima, referência embaixo. */
export function BurstCompare({ w }: { w: BurstWindow }) {
  return (
    <div className="burst-compare">
      <div className="burst-axis" aria-hidden>
        <span />
        <div className="burst-ticks">
          {BURST_TICKS.map((t) => (
            <span key={t} style={{ left: `${burstPos(t)}%` }}>
              {t === 0 ? 'uso' : `+${t / 1000}s`}
            </span>
          ))}
        </div>
      </div>
      <BurstLane label="Você" side={w.mine} />
      <BurstLane label="Referência" side={w.ref} />
      {w.mine && w.ref && (
        <p className="muted small">
          {w.mine.casts.length} casts contra {w.ref.casts.length} na janela · usado {signedSec(w.mine.start - w.ref.start)} em relação à referência (
          {mmss(w.mine.start)} × {mmss(w.ref.start)})
        </p>
      )}
    </div>
  );
}

function BurstLane({ label, side }: { label: string; side: BurstSide | null }) {
  // casts colados no tempo não se cobrem: cada um vai para a primeira linha livre
  const rows: number[] = [];
  const placed = (side?.casts ?? []).map((c) => {
    const pos = burstPos(c.dt);
    let row = rows.findIndex((last) => pos - last >= ICON_GAP_PCT);
    if (row < 0) row = rows.push(pos) - 1;
    else rows[row] = pos;
    return { c, pos, row };
  });
  return (
    <div className="burst-lane">
      <span className="muted small burst-who">{label}</span>
      {side ? (
        <ol className="burst-track" style={{ height: Math.max(1, rows.length) * 26 + 4 }} aria-label={`${label}: ${side.casts.map((c) => c.name).join(', ')}`}>
          <span className="burst-zero" style={{ left: `${burstPos(0)}%` }} aria-hidden />
          {placed.map(({ c, pos, row }, i) => (
            <li
              key={i}
              className={c.dt < 0 ? 'pre' : ''}
              style={{ left: `${pos}%`, top: row * 26 + 2 }}
              title={`${c.name} · ${c.dt >= 0 ? '+' : '−'}${(Math.abs(c.dt) / 1000).toFixed(1)}s`}
            >
              <SpellIcon spellId={c.spellId} size={22} />
            </li>
          ))}
        </ol>
      ) : (
        <span className="small warn">não usou este cooldown</span>
      )}
    </div>
  );
}

// ---- rotação

export function Rotation({ me, ref_, cds, expanded = false }: { me: Sample; ref_: Sample; cds: ReturnType<typeof detectCooldowns>; expanded?: boolean }) {
  const rows = compareRotation(me, ref_, cds);
  const [open, setShowAll] = useState(false);
  const showAll = open || expanded;
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
      {!expanded && core.length < rows.length && (
        <button className="link small more-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          <ChevronDown size={14} strokeWidth={1.5} className={`chev-down ${showAll ? 'open' : ''}`} aria-hidden />
          {showAll ? 'Só a rotação' : `Mostrar ${rows.length - core.length} utilitária${rows.length - core.length > 1 ? 's' : ''} (movimento, buffs)`}
        </button>
      )}
    </section>
  );
}

// ---- poções

export function Potions({ me, ref_ }: { me: Sample; ref_: Sample }) {
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

export function SetupView({ me, ref_ }: { me: PlayerStats; ref_: PlayerStats }) {
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
