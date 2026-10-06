import { useState } from 'react';
import type { EnemySpell, MechanicSeverity, Pull } from '../types';
import { rulesGet, rulesSaveTuning, type RuleMechanic } from '../lib/rules';
import { num } from '../lib/format';
import { messagesOf, useMessages } from '../i18n';
import { createRuleMsg } from './CreateRule.i18n';

/** O que o usuário quer dizer com a habilidade, em linguagem simples -> tipo de regra. */
const KINDS = ['avoidable_damage', 'failure_event', 'interrupt', 'dispel', 'stack_limit', 'unavoidable'] as const;

type Kind = (typeof KINDS)[number];

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
  // regra do usuário: um texto só, no idioma em que ele está usando o app
  const message = kind === 'unavoidable' ? name : messagesOf(createRuleMsg).message[kind](name);
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
  const t = messagesOf(createRuleMsg);
  if (kind === 'avoidable_damage') return s.hitsOnPlayers ? t.previewHits(s.hitsOnPlayers) : t.previewNoHits;
  if (kind === 'failure_event') return s.hitsOnPlayers || s.casts ? t.previewHappened(s.casts, s.hitsOnPlayers) : t.previewNotHappened;
  if (kind === 'interrupt') return t.previewKicks(s.interrupted, s.casts);
  if (kind === 'unavoidable') return t.previewDamage(num(s.damageToPlayers));
  return t.previewAura;
}

/** Assistente de "criar regra" a partir de uma habilidade do log. */
export function CreateRule({ pull, spell, onSaved, onCancel }: { pull: Pull; spell: EnemySpell; onSaved: () => void; onCancel: () => void }) {
  const m = useMessages(createRuleMsg);
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
      const rule = buildRule(kind, Number(id), spell.name, severity, tip.trim() || m.kinds[kind].hint, {
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
      <div className="chips" role="radiogroup" aria-label={m.whatIsIt}>
        {KINDS.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'active' : ''}
            onClick={() => {
              setKind(k);
              setSeverity(SEVERITY_BY_KIND[k]);
            }}
          >
            {m.kinds[k].label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {m.kinds[kind].hint} {preview(kind, spell)}
      </p>
      <div className="rule-fields">
        <label className="field sm">
          {m.spellId} {kind === 'dispel' || kind === 'stack_limit' ? m.ofDebuff : ''}
          <input className="text-input" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="field sm">
          {m.severity}
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as MechanicSeverity)}>
            {(['wipe', 'major', 'minor', 'none'] as const).map((s) => (
              <option key={s} value={s}>
                {m.severities[s]}
              </option>
            ))}
          </select>
        </label>
        {kind === 'avoidable_damage' && (
          <label className="field sm">
            {m.tolerance}
            <input className="text-input" type="number" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
          </label>
        )}
        {kind === 'stack_limit' && (
          <>
            <label className="field sm">
              {m.warnFrom}
              <input className="text-input" type="number" min={0} value={warn} placeholder={m.noWarning} onChange={(e) => setWarn(e.target.value)} />
            </label>
            <label className="field sm">
              {m.lethal}
              <input className="text-input" type="number" min={1} value={lethal} onChange={(e) => setLethal(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'dispel' && (
          <label className="field sm">
            {m.maxDelay}
            <input className="text-input" type="number" min={0} step={0.5} value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)} />
          </label>
        )}
      </div>
      <label className="field">
        {m.tip}
        <input className="text-input" value={tip} placeholder={m.tipPlaceholder} onChange={(e) => setTip(e.target.value)} />
      </label>
      {msg && <p className="small bad">{msg}</p>}
      <div className="dialog-actions">
        <span className="topbar-spacer" />
        <button className="btn" onClick={onCancel}>
          {m.cancel}
        </button>
        <button className="btn primary" onClick={save} disabled={busy || !id}>
          {busy ? m.saving : m.create}
        </button>
      </div>
    </div>
  );
}
