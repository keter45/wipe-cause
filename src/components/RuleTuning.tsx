import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, RotateCcw, Star, Upload } from 'lucide-react';
import { saveJson, fileSlug } from '../lib/share';
import type { MechanicSeverity, Pull } from '../types';
import {
  cleanTuning,
  effective,
  exportTuning,
  parseTuningFile,
  PER_HIT,
  rulesGet,
  rulesResetTuning,
  rulesSaveTuning,
  type BossRules,
  type MechanicTuning,
  type RuleMechanic,
  type Tuning,
} from '../lib/rules';
import { mechanicSpellId } from '../lib/spells';
import { SpellIcon } from './SpellIcon';
import { messagesOf, useMessages } from '../i18n';
import { tuningMsg } from './RuleTuning.i18n';

/** Nome do tipo de regra no idioma atual. */
export const kindLabel = (kind: string) => messagesOf(tuningMsg).kinds[kind] ?? kind;

const SEVERITIES: MechanicSeverity[] = ['wipe', 'major', 'minor', 'none'];

const ROLES = [
  { value: 'tank', label: 'Tank' },
  { value: 'healer', label: 'Healer' },
  { value: 'dps', label: 'DPS' },
];

/**
 * Ajustes das regras do boss: ligar/desligar, gravidade, tolerância, stacks, dispel, foco, quem
 * pode ser culpado e os textos. Salva só o que mudou e reanalisa o log.
 */
export function RuleTuning({ pull, onSaved, onClose }: { pull: Pull; onSaved: () => void; onClose: () => void }) {
  const t = useMessages(tuningMsg);
  const [rules, setRules] = useState<BossRules | null>(null);
  const [draft, setDraft] = useState<Tuning | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    rulesGet(pull)
      .then((r) => {
        if (!alive) return;
        setRules(r);
        setDraft(r.tuning ?? { encounter_id: r.encounterId, name: r.name, mechanics: {}, custom: [] });
      })
      .catch((e) => alive && setMsg({ ok: false, text: String(e) }));
    return () => {
      alive = false;
    };
  }, [pull.encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useMemo(() => JSON.stringify(rules?.tuning ?? null), [rules]);
  if (!rules || !draft) return <p className="muted pad">{msg?.text ?? t.reading}</p>;

  // só as mecânicas que dá para ajustar (contexto puro não tem o que ajustar além de ligar)
  const mechs = rules.mechanics;
  const set = (key: string, patch: MechanicTuning) =>
    setDraft((d) => d && { ...d, mechanics: { ...d.mechanics, [key]: { ...d.mechanics[key], ...patch } } });
  const resetOne = (key: string) =>
    setDraft((d) => {
      if (!d) return d;
      const { [key]: _drop, ...rest } = d.mechanics;
      return { ...d, mechanics: rest };
    });
  const clean = cleanTuning(draft, mechs);
  const dirty = JSON.stringify(Object.keys(clean.mechanics).length || clean.custom.length ? clean : null) !== saved;
  const tunedCount = Object.keys(clean.mechanics).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await rulesSaveTuning(clean);
      setRules((r) => r && { ...r, tuning: Object.keys(clean.mechanics).length || clean.custom.length ? clean : null });
      setMsg({ ok: true, text: t.saved });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    setBusy(true);
    try {
      await rulesResetTuning(rules!.encounterId);
      setRules((r) => r && { ...r, tuning: null });
      setDraft({ encounter_id: rules!.encounterId, name: rules!.name, mechanics: {}, custom: draft!.custom });
      setMsg({ ok: true, text: t.reset });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rule-tuning">
      <header className="rule-tuning-head">
        <div>
          <h3>{t.title(rules.name)}</h3>
          <p className="muted small">{t.intro}</p>
        </div>
        <div className="rule-tuning-actions">
          <button
            className="btn sm"
            disabled={!rules.tuning}
            title={rules.tuning ? t.exportTitle : t.exportNone}
            onClick={() => rules.tuning && saveJson(exportTuning(rules.tuning, rules.name), t.exportFile(fileSlug(rules.name))).catch((e) => setMsg({ ok: false, text: String(e) }))}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden /> {t.export}
          </button>
          <label className="btn sm" title={t.importTitle}>
            <Upload size={14} strokeWidth={1.5} aria-hidden /> {t.import}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const imported = parseTuningFile(await file.text(), rules.encounterId);
                  setDraft(imported);
                  setMsg({ ok: true, text: t.imported });
                } catch (err) {
                  setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
                }
              }}
            />
          </label>
          <button className="btn sm" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </header>

      {mechs.length === 0 && <p className="muted small">{t.noRules}</p>}

      <div className="rule-rows" role="list">
        {mechs.map((m) => (
          <RuleRow
            key={m.key}
            m={m}
            ov={draft.mechanics[m.key]}
            spellId={mechanicSpellId(pull, m.key)}
            open={open === m.key}
            onToggleOpen={() => setOpen(open === m.key ? null : m.key)}
            onChange={(patch) => set(m.key, patch)}
            onReset={() => resetOne(m.key)}
          />
        ))}
      </div>

      {draft.custom.length > 0 && (
        <section className="custom-rules">
          <h4>{t.yourRules}</h4>
          <p className="muted small">{t.yourRulesHint}</p>
          <ul className="plain">
            {draft.custom.map((c) => (
              <li key={c.key} className="custom-rule">
                <span>
                  <strong>{c.name}</strong> <span className="muted small">· {kindLabel(c.type)} · {t.severities[c.severity ?? 'minor'] ?? c.severity}</span>
                </span>
                <button className="link small" onClick={() => setDraft((d) => d && { ...d, custom: d.custom.filter((x) => x.key !== c.key) })}>
                  {t.delete}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="dialog-actions">
        {(rules.tuning || tunedCount > 0) && (
          <button className="btn" onClick={resetAll} disabled={busy}>
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> {t.restore}
          </button>
        )}
        <span className="topbar-spacer" />
        <span className="muted small">{tunedCount ? t.tuned(tunedCount) : t.defaults}</span>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>
          {busy ? t.saving : t.save}
        </button>
      </div>
    </div>
  );
}

function RuleRow({
  m,
  ov,
  spellId,
  open,
  onToggleOpen,
  onChange,
  onReset,
}: {
  m: RuleMechanic;
  ov: MechanicTuning | undefined;
  spellId: number | null;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (p: MechanicTuning) => void;
  onReset: () => void;
}) {
  const t = useMessages(tuningMsg);
  const enabled = ov?.enabled !== false;
  const focus = !!ov?.focus;
  const severity = (effective(m, ov, 'severity') ?? 'minor') as MechanicSeverity;
  const tuned = !!ov && Object.keys(ov).length > 0;
  const num = (v: string) => (v === '' ? undefined : Math.max(0, Number(v)));
  const roles = effective(m, ov, 'roles') ?? [];
  const toggleRole = (r: string) => {
    const cur = roles.length ? roles : ROLES.map((x) => x.value);
    const next = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
    onChange({ roles: next.length === ROLES.length ? [] : next });
  };

  return (
    <div className={`rule-row ${enabled ? '' : 'off'} ${tuned ? 'tuned' : ''}`} role="listitem">
      <div className="rule-line">
        <label className="switch" title={enabled ? t.turnOff : t.turnOn}>
          <input type="checkbox" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <span aria-hidden />
        </label>
        <button className={`icon-btn sm focus-star ${focus ? 'on' : ''}`} onClick={() => onChange({ focus: !focus })} aria-pressed={focus} title={t.focus}>
          <Star size={15} strokeWidth={1.75} fill={focus ? 'currentColor' : 'none'} aria-hidden />
        </button>
        <span className="rule-name">
          <SpellIcon spellId={spellId} size={18} /> {m.name}
          <span className="muted small"> · {kindLabel(m.type)}</span>
          {m.difficulty?.length ? <span className="muted small"> · {m.difficulty.join('/')}</span> : null}
        </span>
        <select className="select sm" value={severity} disabled={!enabled} onChange={(e) => onChange({ severity: e.target.value as MechanicSeverity })} aria-label={t.severity}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t.severities[s]}
            </option>
          ))}
        </select>
        {/* sempre no lugar (invisível sem ajuste) para a coluna de gravidade não pular */}
        <button className={`icon-btn sm ${tuned ? '' : 'invisible'}`} onClick={onReset} title={t.backToDefault} tabIndex={tuned ? 0 : -1} aria-hidden={!tuned}>
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
        </button>
        <button className="icon-btn sm" onClick={onToggleOpen} aria-expanded={open} title={t.more}>
          <ChevronDown size={15} strokeWidth={1.5} className={`chev-down ${open ? 'open' : ''}`} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="rule-detail">
          <div className="rule-fields">
            {PER_HIT.has(m.type) && (
              <label className="field sm">
                {t.tolerance}
                <input className="text-input" type="number" min={0} value={effective(m, ov, 'tolerance') ?? 0} onChange={(e) => onChange({ tolerance: num(e.target.value) })} />
              </label>
            )}
            {m.type === 'stack_limit' && (
              <>
                <label className="field sm">
                  {t.warnStacks}
                  <input className="text-input" type="number" min={0} value={effective(m, ov, 'warn_stacks') ?? ''} placeholder={t.noWarning} onChange={(e) => onChange({ warn_stacks: num(e.target.value) })} />
                </label>
                <label className="field sm">
                  {t.lethalStacks}
                  <input className="text-input" type="number" min={0} value={effective(m, ov, 'lethal_stacks') ?? ''} onChange={(e) => onChange({ lethal_stacks: num(e.target.value) })} />
                </label>
              </>
            )}
            {m.type === 'dispel' && (
              <label className="field sm">
                {t.maxDelay}
                <input className="text-input" type="number" min={0} step={0.5} value={effective(m, ov, 'max_delay') ?? ''} onChange={(e) => onChange({ max_delay: num(e.target.value) })} />
              </label>
            )}
            {m.type === 'phase_duration' && (
              <>
                <label className="field sm">
                  {t.targetS}
                  <input className="text-input" type="number" min={0} step={0.5} value={effective(m, ov, 'target_s') ?? ''} onChange={(e) => onChange({ target_s: num(e.target.value) })} />
                </label>
                <label className="field sm">
                  {t.maxS}
                  <input className="text-input" type="number" min={0} step={0.5} value={effective(m, ov, 'max_s') ?? ''} onChange={(e) => onChange({ max_s: num(e.target.value) })} />
                </label>
                {m.overrides && Object.keys(m.overrides).length > 0 && !ov?.target_s && !ov?.max_s && (
                  <p className="muted small">
                    {t.perDifficulty(
                      Object.entries(m.overrides)
                        .filter(([, o]) => o.target_s != null || o.max_s != null)
                        .map(([d, o]) => `${d}: ${o.target_s ?? '—'}s / ${o.max_s ?? '—'}s`)
                        .join(', '),
                    )}
                  </p>
                )}
              </>
            )}
            <div className="field sm">
              {t.blame}
              <div className="chips">
                {ROLES.map((r) => {
                  const on = roles.length === 0 || roles.includes(r.value);
                  return (
                    <button key={r.value} className={on ? 'active' : ''} aria-pressed={on} onClick={() => toggleRole(r.value)}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <label className="field">
            {t.tip}
            <input className="text-input" value={effective(m, ov, 'tip') ?? ''} onChange={(e) => onChange({ tip: e.target.value })} />
          </label>
          <label className="field">
            {t.message} <span className="muted small">— {'{player}'} {'{count}'} {'{stacks}'}</span>
            <input className="text-input" value={effective(m, ov, 'message') ?? ''} onChange={(e) => onChange({ message: e.target.value })} />
          </label>
          <p className="muted small">{t.customTextNote}</p>
          {typeof m.notes === 'string' && m.notes && <p className="muted small">{t.ruleNote(m.notes)}</p>}
        </div>
      )}
    </div>
  );
}
