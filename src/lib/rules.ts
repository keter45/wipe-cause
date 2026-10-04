// Ajustes do usuário nas regras de boss: uma camada por cima da regra do app (só o que mudou),
// salva por boss. No navegador (desenvolvimento da UI) fica no localStorage.

import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './api';
import type { MechanicSeverity, Pull } from '../types';
import { tr } from '../i18n';

/** Mecânica como está no YAML (o padrão). */
export interface RuleMechanic {
  key: string;
  name: string;
  type: string;
  severity?: MechanicSeverity;
  tolerance?: number;
  warn_stacks?: number;
  lethal_stacks?: number;
  max_delay?: number;
  target_s?: number;
  max_s?: number;
  roles?: string[];
  difficulty?: string[];
  tip?: string;
  message?: string;
  detect?: Record<string, unknown>;
  overrides?: Record<string, Record<string, unknown>>;
  notes?: string;
  [k: string]: unknown;
}

/** Campos ajustáveis de uma mecânica (+ `enabled: false` para desligar). */
export interface MechanicTuning {
  enabled?: boolean;
  severity?: MechanicSeverity;
  tolerance?: number;
  warn_stacks?: number;
  lethal_stacks?: number;
  max_delay?: number;
  target_s?: number;
  max_s?: number;
  roles?: string[];
  tip?: string;
  message?: string;
  focus?: boolean;
}

export interface Tuning {
  encounter_id: number;
  name?: string | null;
  mechanics: Record<string, MechanicTuning>;
  custom: RuleMechanic[];
}

export interface BossRules {
  encounterId: number;
  name: string;
  file: string | null;
  mechanics: RuleMechanic[];
  tuning: Tuning | null;
}

const DEMO_KEY = 'wipe-cause:demo-tuning:';

/** No navegador: monta a regra a partir das mecânicas do pull (só para ver a tela). */
function demoRules(pull: Pull): BossRules {
  let tuning: Tuning | null = null;
  try {
    tuning = JSON.parse(localStorage.getItem(DEMO_KEY + pull.encounterId) ?? 'null');
  } catch {
    /* sem storage */
  }
  return {
    encounterId: pull.encounterId,
    name: pull.encounterName,
    file: pull.rulesFile ?? null,
    mechanics: pull.mechanics
      .filter((m) => !m.custom)
      .map((m) => ({ key: m.key, name: m.name, type: m.kind, severity: m.severity, tip: tr(m.tip) })),
    tuning,
  };
}

export async function rulesGet(pull: Pull): Promise<BossRules> {
  if (!inTauri) return demoRules(pull);
  return invoke<BossRules>('rules_get', { encounterId: pull.encounterId, name: pull.encounterName });
}

export async function rulesSaveTuning(tuning: Tuning): Promise<void> {
  if (!inTauri) {
    localStorage.setItem(DEMO_KEY + tuning.encounter_id, JSON.stringify(tuning));
    return;
  }
  await invoke('rules_save_tuning', { tuning });
}

export async function rulesResetTuning(encounterId: number): Promise<void> {
  if (!inTauri) {
    localStorage.removeItem(DEMO_KEY + encounterId);
    return;
  }
  await invoke('rules_reset_tuning', { encounterId });
}

/** Tira do ajuste os campos iguais ao padrão (e mecânicas sem ajuste nenhum). */
export function cleanTuning(t: Tuning, base: RuleMechanic[]): Tuning {
  const mechanics: Record<string, MechanicTuning> = {};
  for (const [key, ov] of Object.entries(t.mechanics)) {
    const b = base.find((m) => m.key === key);
    const out: MechanicTuning = {};
    for (const [k, v] of Object.entries(ov) as [keyof MechanicTuning, unknown][]) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'enabled' && v === true) continue;
      if (k === 'focus' && v === false) continue;
      if (b && k !== 'enabled' && k !== 'focus' && JSON.stringify(b[k]) === JSON.stringify(v)) continue;
      (out as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(out).length) mechanics[key] = out;
  }
  return { ...t, mechanics };
}

/** Arquivo exportado: os ajustes e de qual boss são (para não importar no boss errado). */
export function exportTuning(t: Tuning, bossName: string): string {
  return JSON.stringify({ app: 'wipe-cause', kind: 'rule-tuning', boss: bossName, ...t }, null, 2);
}

/** Lê um arquivo exportado; erro se não for de ajustes ou for de outro boss. */
export function parseTuningFile(text: string, encounterId: number): Tuning {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const o = raw as Partial<Tuning> & { boss?: string };
  if (!o || typeof o !== 'object' || typeof o.encounter_id !== 'number' || typeof o.mechanics !== 'object')
    throw new Error('O arquivo não é de ajustes de regras do Wipe Cause.');
  if (o.encounter_id !== encounterId) throw new Error(`Esses ajustes são de outro boss${o.boss ? ` (${o.boss})` : ''}.`);
  return { encounter_id: o.encounter_id, name: o.name ?? null, mechanics: o.mechanics ?? {}, custom: Array.isArray(o.custom) ? o.custom : [] };
}

/** Valor efetivo de um campo: o ajuste, senão o padrão. */
export function effective<K extends keyof MechanicTuning>(base: RuleMechanic, ov: MechanicTuning | undefined, k: K): MechanicTuning[K] | undefined {
  return (ov?.[k] ?? (base as MechanicTuning)[k]) as MechanicTuning[K] | undefined;
}

/** Tipos em que cada hit é erro de quem tomou (a tolerância faz sentido). */
export const PER_HIT = new Set(['avoidable_damage', 'tank_range', 'positioning']);
