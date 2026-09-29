import { useState } from 'react';
import type { EnemySpell, MechanicSeverity, Pull } from '../types';
import { rulesGet, rulesSaveTuning, type RuleMechanic } from '../lib/rules';
import { num } from '../lib/format';

/** O que o usuário quer dizer com a habilidade, em linguagem simples -> tipo de regra. */
const KINDS = [
  { value: 'avoidable_damage', label: 'Tomar isso é erro', hint: 'Cada hit em player conta como erro de quem tomou (poça, linha, frontal).' },
  { value: 'failure_event', label: 'Isso acontecer é falha do raid', hint: 'Explosão, orb perdido, algo que só sai quando o raid erra.' },
  { value: 'interrupt', label: 'Tem que ser cortado', hint: 'Cada cast que passa sem interrupt é falha.' },
  { value: 'dispel', label: 'Tem que ser dispelado', hint: 'Mede o tempo até o dispel e quem ficou sem.' },
  { value: 'stack_limit', label: 'Stack que mata', hint: 'Avisa quando alguém passa do limite de stacks.' },
  { value: 'unavoidable', label: 'Só contexto', hint: 'Dano de raid que não é culpa de ninguém; aparece nas mortes.' },
] as const;

type Kind = (typeof KINDS)[number]['value'];

const SEVERITY_BY_KIND: Record<Kind, MechanicSeverity> = {
  avoidable_damage: 'minor',
  failure_event: 'major',
  interrupt: 'major',
  dispel: 'minor',
  stack_limit: 'major',
  unavoidable: 'none',
};

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Regra no formato do YAML a partir das escolhas do assistente. */
export function buildRule(kind: Kind, id: number, name: string, severity: MechanicSeverity, tip: string, opts: { tolerance?: number; warn?: number; lethal?: number; maxDelay?: number }): RuleMechanic {
  const detect: Record<string, unknown> =
    kind === 'interrupt'
      ? { cast_id: id }
      : kind === 'dispel' || kind === 'stack_limit'
        ? { aura_id: id }
        : kind === 'failure_event'
          ? { fail_ids: [id] }
          : { damage_ids: [id] };
  const message =
    kind === 'avoidable_damage'
      ? `{player} tomou ${name} ({count}x)`
      : kind === 'failure_event'
        ? `${name} aconteceu {count}x`
        : kind === 'interrupt'
          ? `{count} ${name} passaram sem interrupt`
          : kind === 'dispel'
            ? `{count} ${name} sem dispel a tempo`
            : kind === 'stack_limit'
              ? `{player} chegou a {stacks} stacks de ${name}`
              : name;
  return {
    key: `${slug(name)}_${id}`,
    name,
    type: kind,
    severity,
    detect,
    tip,
    message,
    ...(kind === 'avoidable_damage' && opts.tolerance ? { tolerance: opts.tolerance } : {}),
    ...(kind === 'stack_limit' ? { lethal_stacks: opts.lethal ?? 10, ...(opts.warn ? { warn_stacks: opts.warn } : {}) } : {}),
    ...(kind === 'dispel' ? { max_delay: opts.maxDelay ?? 5 } : {}),
  };
}

/** Prévia com o que o log deste pull já mostra (sem reanalisar). */
function preview(kind: Kind, s: EnemySpell): string {
  if (kind === 'avoidable_damage') return s.hitsOnPlayers ? `Neste pull: ${s.hitsOnPlayers} hit(s) em players seriam erro.` : 'Neste pull ninguém tomou dano deste spell.';
  if (kind === 'failure_event') return s.hitsOnPlayers || s.casts ? `Neste pull: aconteceu (${s.casts} cast(s), ${s.hitsOnPlayers} hit(s)).` : 'Neste pull não aconteceu.';
  if (kind === 'interrupt') return `Neste pull: ${s.interrupted} cortado(s), ${s.casts} passaram.`;
  if (kind === 'unavoidable') return `Neste pull: ${num(s.damageToPlayers)} de dano em players.`;
  return 'O ID precisa ser o do debuff (aura); confira se é o mesmo do dano.';
}

/** Assistente de "criar regra" a partir de uma habilidade do log. */
export function CreateRule({ pull, spell, onSaved, onCancel }: { pull: Pull; spell: EnemySpell; onSaved: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<Kind>(spell.interrupted > 0 ? 'interrupt' : spell.hitsOnPlayers > 0 ? 'avoidable_damage' : 'failure_event');
  const [id, setId] = useState(String(spell.spellId));
  const [severity, setSeverity] = useState<MechanicSeverity>(SEVERITY_BY_KIND[kind]);
  const [tip, setTip] = useState('');
  const [tolerance, setTolerance] = useState('0');
  const [warn, setWarn] = useState('');
  const [lethal, setLethal] = useState('10');
  const [maxDelay, setMaxDelay] = useState('5');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const rules = await rulesGet(pull);
      const t = rules.tuning ?? { encounter_id: rules.encounterId, name: rules.name, mechanics: {}, custom: [] };
      const rule = buildRule(kind, Number(id), spell.name, severity, tip.trim() || KINDS.find((k) => k.value === kind)!.hint, {
        tolerance: Number(tolerance) || 0,
        warn: warn ? Number(warn) : undefined,
        lethal: Number(lethal) || 10,
        maxDelay: Number(maxDelay) || 5,
      });
      await rulesSaveTuning({ ...t, name: rules.name, custom: [...t.custom.filter((c) => c.key !== rule.key), rule] });
      onSaved();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create-rule">
      <div className="chips" role="radiogroup" aria-label="O que é esta habilidade">
        {KINDS.map((k) => (
          <button
            key={k.value}
            role="radio"
            aria-checked={kind === k.value}
            className={kind === k.value ? 'active' : ''}
            onClick={() => {
              setKind(k.value);
              setSeverity(SEVERITY_BY_KIND[k.value]);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {KINDS.find((k) => k.value === kind)!.hint} {preview(kind, spell)}
      </p>
      <div className="rule-fields">
        <label className="field sm">
          Spell ID {kind === 'dispel' || kind === 'stack_limit' ? '(do debuff)' : ''}
          <input className="text-input" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="field sm">
          Gravidade
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as MechanicSeverity)}>
            <option value="wipe">Causa de wipe</option>
            <option value="major">Grave</option>
            <option value="minor">Atenção</option>
            <option value="none">Só contexto</option>
          </select>
        </label>
        {kind === 'avoidable_damage' && (
          <label className="field sm">
            Hits tolerados por player
            <input className="text-input" type="number" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </label>
        )}
        {kind === 'stack_limit' && (
          <>
            <label className="field sm">
              Avisar a partir de
              <input className="text-input" type="number" min={0} value={warn} placeholder="sem aviso" onChange={(e) => setWarn(e.target.value)} />
            </label>
            <label className="field sm">
              Stacks que matam
              <input className="text-input" type="number" min={1} value={lethal} onChange={(e) => setLethal(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'dispel' && (
          <label className="field sm">
            Tempo máximo até o dispel (s)
            <input className="text-input" type="number" min={0} step={0.5} value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)} />
          </label>
        )}
      </div>
      <label className="field">
        Dica para o raid
        <input className="text-input" value={tip} placeholder="ex.: sair da poça para a borda" onChange={(e) => setTip(e.target.value)} />
      </label>
      {msg && <p className="small bad">{msg}</p>}
      <div className="dialog-actions">
        <span className="topbar-spacer" />
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary" onClick={save} disabled={busy || !id}>
          {busy ? 'Salvando…' : 'Criar regra e reanalisar'}
        </button>
      </div>
    </div>
  );
}
