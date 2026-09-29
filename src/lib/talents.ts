// Nomes e ícones dos talentos por spec (dados públicos do Raidbots). No app vem do backend,
// que guarda em cache; no navegador (desenvolvimento da UI) busca direto.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { inTauri } from './api';

export interface TalentEntry {
  name: string;
  spellId: number | null;
  icon: string | null;
  nodeId: number;
  maxRanks: number;
  tree: 'class' | 'spec' | 'hero';
}

export type TalentTree = Map<number, TalentEntry>;

const TALENTS_URL = 'https://www.raidbots.com/static/data/live/talents.json';

interface RawEntry {
  id: number;
  name?: string;
  spellId?: number;
  icon?: string;
  maxRanks?: number;
}
interface RawSpec {
  specId: number;
  classNodes?: { id: number; entries: RawEntry[] }[];
  specNodes?: { id: number; entries: RawEntry[] }[];
  heroNodes?: { id: number; entries: RawEntry[] }[];
}

let browserData: Promise<RawSpec[]> | null = null;

async function browserTree(specId: number): Promise<TalentTree> {
  browserData ??= fetch(TALENTS_URL).then((r) => r.json() as Promise<RawSpec[]>);
  const spec = (await browserData).find((s) => s.specId === specId);
  const out: TalentTree = new Map();
  if (!spec) return out;
  for (const [key, tree] of [
    ['classNodes', 'class'],
    ['specNodes', 'spec'],
    ['heroNodes', 'hero'],
  ] as const) {
    for (const node of spec[key] ?? [])
      for (const e of node.entries)
        out.set(e.id, { name: e.name ?? '?', spellId: e.spellId ?? null, icon: e.icon ?? null, nodeId: node.id, maxRanks: e.maxRanks ?? 1, tree });
  }
  return out;
}

const cache = new Map<number, Promise<TalentTree>>();

export function talentTree(specId: number): Promise<TalentTree> {
  let p = cache.get(specId);
  if (!p) {
    p = inTauri
      ? invoke<Record<string, TalentEntry>>('talent_tree', { specId }).then((o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v])))
      : browserTree(specId);
    // falhou (sem internet): tenta de novo na próxima vez
    p.catch(() => cache.delete(specId));
    cache.set(specId, p);
  }
  return p;
}

/** Árvore da spec; `null` enquanto carrega ou se não deu para baixar (mostra só os números). */
export function useTalentTree(specId: number | null | undefined): { tree: TalentTree | null; error: string | null } {
  const [state, setState] = useState<{ tree: TalentTree | null; error: string | null }>({ tree: null, error: null });
  useEffect(() => {
    if (specId == null) return;
    let alive = true;
    setState({ tree: null, error: null });
    talentTree(specId)
      .then((tree) => alive && setState({ tree, error: null }))
      .catch((e) => alive && setState({ tree: null, error: String(e) }));
    return () => {
      alive = false;
    };
  }, [specId]);
  return state;
}
