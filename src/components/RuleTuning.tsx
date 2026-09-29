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

export const KIND_LABEL: Record<string, string> = {
  avoidable_damage: 'Dano evitável',
  stack_limit: 'Limite de stacks',
  soak: 'Soak',
  tank_soak: 'Soak de tank',
  interrupt: 'Interrupt',
  tank_range: 'Alcance do tank',
  positioning: 'Posicionamento',
  enrage: 'Enrage',
  failure_event: 'Falha do raid',
  dispel: 'Dispel',
  hp_balance: 'HP dos bosses',
  cc_required: 'CC',
  spread: 'Espalhar',
  add_kill: 'Matar adds',
  unavoidable: 'Contexto',
  info: 'Dica',
};

const SEVERITIES: { value: MechanicSeverity; label: string }[] = [
  { value: 'wipe', label: 'Causa de wipe' },
  { value: 'major', label: 'Grave' },
  { value: 'minor', label: 'Atenção' },
  { value: 'none', label: 'Só contexto' },
];

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
  if (!rules || !draft) return <p className="muted pad">{msg?.text ?? 'Lendo as regras…'}</p>;

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
      setMsg({ ok: true, text: 'Ajustes salvos. Reanalisando o log…' });
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
      setMsg({ ok: true, text: 'Regras de volta ao padrão. Reanalisando o log…' });
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
          <h3>Ajustar regras · {rules.name}</h3>
          <p className="muted small">
            Vale para todos os pulls deste boss, nas próximas análises. Marque com ★ o foco da progressão: essas mecânicas vêm primeiro no
            veredito.
          </p>
        </div>
        <div className="rule-tuning-actions">
          <button
            className="btn sm"
            disabled={!rules.tuning}
            title={rules.tuning ? 'Salvar os ajustes num arquivo para mandar a outra pessoa' : 'Sem ajustes salvos para exportar'}
            onClick={() => rules.tuning && saveJson(exportTuning(rules.tuning, rules.name), `ajustes-${fileSlug(rules.name)}.json`).catch((e) => setMsg({ ok: false, text: String(e) }))}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden /> Exportar
          </button>
          <label className="btn sm" title="Carregar ajustes que alguém exportou (revise e salve)">
            <Upload size={14} strokeWidth={1.5} aria-hidden /> Importar
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const t = parseTuningFile(await file.text(), rules.encounterId);
                  setDraft(t);
                  setMsg({ ok: true, text: 'Ajustes importados. Confira e clique em Salvar e reanalisar.' });
                } catch (err) {
                  setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
                }
              }}
            />
          </label>
          <button className="btn sm" onClick={onClose}>
            Fechar
          </button>
        </div>
      </header>

      {mechs.length === 0 && <p className="muted small">Este boss ainda não tem regras no app.</p>}

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
          <h4>Suas regras</h4>
          <p className="muted small">Criadas na aba “Habilidades do boss”. Apagar aqui e salvar remove a regra.</p>
          <ul className="plain">
            {draft.custom.map((c) => (
              <li key={c.key} className="custom-rule">
                <span>
                  <strong>{c.name}</strong> <span className="muted small">· {KIND_LABEL[c.type] ?? c.type} · {c.severity}</span>
                </span>
                <button className="link small" onClick={() => setDraft((d) => d && { ...d, custom: d.custom.filter((x) => x.key !== c.key) })}>
                  apagar
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
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> Restaurar o padrão
          </button>
        )}
        <span className="topbar-spacer" />
        <span className="muted small">{tunedCount ? `${tunedCount} mecânica${tunedCount > 1 ? 's' : ''} ajustada${tunedCount > 1 ? 's' : ''}` : 'Regras padrão'}</span>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Salvando…' : 'Salvar e reanalisar'}
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
        <label className="switch" title={enabled ? 'Desligar esta mecânica' : 'Ligar esta mecânica'}>
          <input type="checkbox" checked={enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <span aria-hidden />
        </label>
        <button className={`icon-btn sm focus-star ${focus ? 'on' : ''}`} onClick={() => onChange({ focus: !focus })} aria-pressed={focus} title="Foco da progressão">
          <Star size={15} strokeWidth={1.75} fill={focus ? 'currentColor' : 'none'} aria-hidden />
        </button>
        <span className="rule-name">
          <SpellIcon spellId={spellId} size={18} /> {m.name}
          <span className="muted small"> · {KIND_LABEL[m.type] ?? m.type}</span>
          {m.difficulty?.length ? <span className="muted small"> · {m.difficulty.join('/')}</span> : null}
        </span>
        <select className="select sm" value={severity} disabled={!enabled} onChange={(e) => onChange({ severity: e.target.value as MechanicSeverity })} aria-label="Gravidade">
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {/* sempre no lugar (invisível sem ajuste) para a coluna de gravidade não pular */}
        <button className={`icon-btn sm ${tuned ? '' : 'invisible'}`} onClick={onReset} title="Voltar ao padrão" tabIndex={tuned ? 0 : -1} aria-hidden={!tuned}>
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
        </button>
        <button className="icon-btn sm" onClick={onToggleOpen} aria-expanded={open} title="Mais opções">
          <ChevronDown size={15} strokeWidth={1.5} className={`chev-down ${open ? 'open' : ''}`} aria-hidden />
        </button>
      </div>

      {open && (
        <div className="rule-detail">
          <div className="rule-fields">
            {PER_HIT.has(m.type) && (
              <label className="field sm">
                Hits tolerados por player
                <input className="text-input" type="number" min={0} value={effective(m, ov, 'tolerance') ?? 0} onChange={(e) => onChange({ tolerance: num(e.target.value) })} />
              </label>
            )}
            {m.type === 'stack_limit' && (
              <>
                <label className="field sm">
                  Avisar a partir de (stacks)
                  <input className="text-input" type="number" min={0} value={effective(m, ov, 'warn_stacks') ?? ''} placeholder="sem aviso" onChange={(e) => onChange({ warn_stacks: num(e.target.value) })} />
                </label>
                <label className="field sm">
                  Stacks que matam
                  <input className="text-input" type="number" min={0} value={effective(m, ov, 'lethal_stacks') ?? ''} onChange={(e) => onChange({ lethal_stacks: num(e.target.value) })} />
                </label>
              </>
            )}
            {m.type === 'dispel' && (
              <label className="field sm">
                Tempo máximo até o dispel (s)
                <input className="text-input" type="number" min={0} step={0.5} value={effective(m, ov, 'max_delay') ?? ''} onChange={(e) => onChange({ max_delay: num(e.target.value) })} />
              </label>
            )}
            <div className="field sm">
              Quem pode ser culpado
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
            Dica (o que o raid deve fazer)
            <input className="text-input" value={effective(m, ov, 'tip') ?? ''} onChange={(e) => onChange({ tip: e.target.value })} />
          </label>
          <label className="field">
            Mensagem no relatório <span className="muted small">— {'{player}'} {'{count}'} {'{stacks}'}</span>
            <input className="text-input" value={effective(m, ov, 'message') ?? ''} onChange={(e) => onChange({ message: e.target.value })} />
          </label>
          {typeof m.notes === 'string' && m.notes && <p className="muted small">Nota da regra: {m.notes}</p>}
        </div>
      )}
    </div>
  );
}
