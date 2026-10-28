// Note de CDs do líder (formato NSRT, o que o MRT mostra na tela): ler sem perder nada, devolver o
// texto com as mudanças sugeridas, casar `ph:` com as fases do boss e guardar as versões coladas.
// Regras em docs/heal-cd-note.md.
//
//   EncounterID:3429;Name:Coiled Altar 2;Difficulty:Mythic
//   time:47;ph:1;tag:Fulano;spellid:97462;
//   time:15;ph:2.5;tag:everyone;text:Personals;
//   intstart … intend                        (escala de interrupts, lida pela aba Interrupts)

import type { PhaseMark, Pull } from '../types';
import { shortName } from './format';

export interface NoteHeader {
  encounterId: number | null;
  name: string | null;
  difficulty: string | null;
}

/** Uma linha do texto, guardada como veio; as linhas com `time` e `ph` também viram campos. */
export interface NoteLine {
  raw: string;
  /** segundos desde o início da fase */
  time?: number;
  /** fase da note normalizada: "1", "2.5" */
  ph?: string;
  tag?: string;
  spellId?: number;
  text?: string;
  glowunit?: string;
}

export interface ParsedNote {
  text: string;
  header: NoteHeader | null;
  lines: NoteLine[];
  /** texto entre `intstart` e `intend` (sem `intend`, até o fim) */
  intBlock: string | null;
  /** tem cabeçalho ou linhas com `time` e `ph` */
  isNsrt: boolean;
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('pt-BR');

function fields(line: string): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const part of line.split(';')) {
    if (!part.trim()) continue;
    const i = part.indexOf(':');
    if (i <= 0) return null;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return out.size ? out : null;
}

/** `ph` como texto normalizado ("2.50" → "2.5"); null se não é número. */
function normPh(v: string | undefined): string | undefined {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? String(n) : undefined;
}

export function parseNote(text: string): ParsedNote {
  const rows = text.split('\n');
  const lines: NoteLine[] = [];
  let header: NoteHeader | null = null;
  let intStart = -1;
  let intEnd = -1;
  rows.forEach((raw, i) => {
    const line: NoteLine = { raw };
    lines.push(line);
    const bare = raw.trim().toLowerCase();
    if (bare === 'intstart' && intStart < 0) intStart = i;
    else if (bare === 'intend' && intStart >= 0 && intEnd < 0) intEnd = i;
    if (intStart >= 0 && (intEnd < 0 || i < intEnd)) return;
    if (!header && /^\s*encounterid:/i.test(raw)) {
      const f = fields(raw.trim());
      header = {
        encounterId: Number(f?.get('encounterid')) || null,
        name: f?.get('name') ?? null,
        difficulty: f?.get('difficulty') ?? null,
      };
      return;
    }
    const f = fields(raw.trim());
    const ph = normPh(f?.get('ph'));
    const time = Number(f?.get('time'));
    if (!f || ph == null || !f.has('time') || !Number.isFinite(time)) return;
    line.time = time;
    line.ph = ph;
    line.tag = f.get('tag');
    const spell = Number(f.get('spellid'));
    if (f.has('spellid') && Number.isFinite(spell)) line.spellId = spell;
    if (f.has('text')) line.text = f.get('text');
    if (f.has('glowunit')) line.glowunit = f.get('glowunit');
  });
  const intBlock = intStart >= 0 ? rows.slice(intStart + 1, intEnd >= 0 ? intEnd : rows.length).join('\n') : null;
  return { text, header, lines, intBlock, isNsrt: header != null || lines.some((l) => l.ph != null) };
}

export type NoteChange =
  | { kind: 'move'; line: number; time: number }
  | { kind: 'add'; time: number; ph: string; tag: string; spellId: number };

const isTimer = (l: NoteLine) => l.ph != null;

/** Onde entra uma linha nova (índice antes do qual ela é inserida). */
function insertAt(lines: NoteLine[], ph: string, time: number): number {
  let lastSame = -1;
  let firstSame = -1;
  let lastBefore = -1;
  lines.forEach((l, i) => {
    if (!isTimer(l)) return;
    if (l.ph === ph) {
      if (firstSame < 0) firstSame = i;
      if ((l.time ?? 0) <= time) lastSame = i;
    } else if (Number(l.ph) < Number(ph)) lastBefore = i;
  });
  if (lastSame >= 0) return lastSame + 1;
  if (firstSame >= 0) return firstSame;
  if (lastBefore >= 0) return lastBefore + 1;
  return lines.length;
}

/** O texto da note com as mudanças; as linhas não tocadas saem iguais. */
export function exportNote(note: ParsedNote, changes: NoteChange[] = []): string {
  if (!changes.length) return note.text;
  const rows: (string | null)[] = note.lines.map((l) => l.raw);
  const lines = note.lines.map((l) => ({ ...l }));
  for (const c of changes) {
    if (c.kind !== 'move') continue;
    const s = Math.round(c.time);
    rows[c.line] = (rows[c.line] ?? '').replace(/(^|;)(\s*time\s*:\s*)[^;]*/i, `$1$2${s}`);
    lines[c.line].time = s;
  }
  // linhas novas: cada uma no lugar pela regra, contando as já inseridas
  const out = rows.map((r, i) => ({ raw: r ?? '', line: lines[i] }));
  for (const c of changes) {
    if (c.kind !== 'add') continue;
    const time = Math.round(c.time);
    const at = insertAt(out.map((o) => o.line), c.ph, time);
    const raw = `time:${time};ph:${c.ph};tag:${c.tag};spellid:${c.spellId};`;
    out.splice(at, 0, { raw, line: { raw, time, ph: c.ph, tag: c.tag, spellId: c.spellId } });
  }
  return out.map((o) => o.raw).join('\n');
}

// ---------------------------------------------------------------------------
// Fases: `ph:n` = fase `p<n>` da regra; `ph:n.5` = a fase sem `p<n>` logo depois de `p<n>`

export function mapPhases(marks: PhaseMark[] | undefined): Map<string, PhaseMark> {
  const list = marks ?? [];
  if (!list.length) return new Map([['1', { key: 'p1', name: '', t: 0 }]]);
  const out = new Map<string, PhaseMark>();
  const dup = new Set<string>();
  const seen = new Set<string>();
  let last = 0;
  for (const m of [...list].sort((a, b) => a.t - b.t)) {
    if (seen.has(m.key)) continue; // fase que se repete: só a primeira vez
    seen.add(m.key);
    const n = /^p(\d+)$/i.exec(m.key);
    let ph: string;
    if (n) {
      last = Number(n[1]);
      ph = String(last);
    } else ph = String(last + 0.5);
    if (out.has(ph)) dup.add(ph);
    out.set(ph, m);
  }
  for (const ph of dup) out.delete(ph);
  return out;
}

// ---------------------------------------------------------------------------
// Versões: a chave atual (texto puro, lida pela escala de interrupts) e a lista de versões

export interface NoteVersion {
  text: string;
  savedAt: number;
  /** data da noite (YYYY-MM-DD do primeiro pull do boss) ou null (sem noite) */
  night: string | null;
  /** número do pull a partir do qual a versão vale nessa noite */
  fromPull: number;
  fromPullManual: boolean;
}

export const MAX_VERSIONS = 20;

type BossKey = Pick<Pull, 'encounterId' | 'difficultyId'>;
const currentKey = (p: BossKey) => `wipe-cause:assignments:${p.encounterId}:${p.difficultyId}`;
const versionsKey = (p: BossKey) => `wipe-cause:heal-note:${p.encounterId}:${p.difficultyId}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Data local (YYYY-MM-DD) do primeiro pull da noite. */
export function nightOf(pulls: Pick<Pull, 'startMs' | 'tzOffsetHours'>[]): string | null {
  if (!pulls.length) return null;
  const first = pulls.reduce((a, b) => (b.startMs < a.startMs ? b : a));
  return new Date(first.startMs + (first.tzOffsetHours ?? 0) * 3_600_000).toISOString().slice(0, 10);
}

export function noteVersions(p: BossKey): NoteVersion[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(versionsKey(p));
    if (raw) return JSON.parse(raw) as NoteVersion[];
    const text = s.getItem(currentKey(p)) ?? '';
    return text.trim() ? [{ text, savedAt: 0, night: null, fromPull: 0, fromPullManual: false }] : [];
  } catch {
    return [];
  }
}

function write(p: BossKey, versions: NoteVersion[]) {
  const s = storage();
  if (!s) return;
  const list = [...versions].sort((a, b) => a.savedAt - b.savedAt).slice(-MAX_VERSIONS);
  try {
    s.setItem(versionsKey(p), JSON.stringify(list));
    const text = list[list.length - 1]?.text ?? '';
    if (text.trim()) s.setItem(currentKey(p), text);
    else s.removeItem(currentKey(p));
  } catch {
    /* sem storage */
  }
}

/** Players das linhas da note (só os que existem na noite), pelo nome curto. */
function notePlayers(text: string, pulls: Pull[]): Set<string> {
  const roster = new Set(pulls.flatMap((p) => p.players.map((x) => norm(shortName(x.name)))));
  const tags = parseNote(text).lines.map((l) => l.tag).filter((t): t is string => !!t && norm(t) !== 'everyone');
  return new Set(tags.map(norm).filter((t) => roster.has(t)));
}

/** "A partir do pull N" padrão de uma versão nova (ou recalculada). */
export function defaultFromPull(text: string, nightPulls: Pull[], live: boolean, nightHasVersion: boolean): number {
  const byNumber = [...nightPulls].sort((a, b) => a.pullNumber - b.pullNumber);
  if (!byNumber.length) return 1;
  if (nightHasVersion || live) return byNumber[byNumber.length - 1].pullNumber + 1;
  const wanted = notePlayers(text, nightPulls);
  const full = byNumber.find((p) => {
    const here = new Set(p.players.map((x) => norm(shortName(x.name))));
    return [...wanted].every((n) => here.has(n));
  });
  return (full ?? byNumber[0]).pullNumber;
}

/**
 * A caixa da note mudou: edita a versão mais nova, ou cria uma da noite aberta (regra "Salvar" do
 * design). Ao vivo, o N padrão é calculado só ao criar a versão.
 */
export function editNote(p: BossKey, text: string, nightPulls: Pull[], live: boolean, now = Date.now()): NoteVersion[] {
  const versions = noteVersions(p);
  const night = nightOf(nightPulls);
  const newest = versions[versions.length - 1];
  const ofNight = !!newest && newest.night != null && newest.night === night;
  if (!text.trim()) {
    if (!ofNight) return versions;
    newest.text = text;
  } else if (ofNight) {
    newest.text = text;
    if (!newest.fromPullManual && !live) {
      const earlier = versions.some((v) => v !== newest && v.night === night);
      newest.fromPull = defaultFromPull(text, nightPulls, live, earlier);
    }
  } else {
    const fromPull = defaultFromPull(text, nightPulls, live, false);
    versions.push({ text, savedAt: now, night, fromPull, fromPullManual: false });
  }
  write(p, versions);
  return noteVersions(p);
}

/** Botão "nova versão": copia a mais nova para a noite aberta; a caixa passa a editar a cópia. */
export function newVersion(p: BossKey, nightPulls: Pull[], live: boolean, now = Date.now()): NoteVersion[] {
  const versions = noteVersions(p);
  const newest = versions[versions.length - 1];
  if (!newest) return versions;
  const night = nightOf(nightPulls);
  const nightHasVersion = versions.some((v) => v.night != null && v.night === night);
  versions.push({ text: newest.text, savedAt: Math.max(now, newest.savedAt + 1), night, fromPull: defaultFromPull(newest.text, nightPulls, live, nightHasVersion), fromPullManual: false });
  write(p, versions);
  return noteVersions(p);
}

/** O líder trocou "a partir do pull N" de uma versão. */
export function setFromPull(p: BossKey, savedAt: number, pullNumber: number): NoteVersion[] {
  const versions = noteVersions(p);
  const v = versions.find((x) => x.savedAt === savedAt);
  if (v) {
    v.fromPull = pullNumber;
    v.fromPullManual = true;
    write(p, versions);
  }
  return noteVersions(p);
}

/** A versão que julga um pull (null = o pull fica fora). */
export function noteFor(pull: Pull, nightPulls: Pull[], versions: NoteVersion[]): NoteVersion | null {
  const night = nightOf(nightPulls.length ? nightPulls : [pull]);
  const latest = (xs: NoteVersion[], by: (v: NoteVersion) => number | string) =>
    xs.reduce<NoteVersion | null>((a, v) => (!a || by(v) > by(a) || (by(v) === by(a) && v.savedAt > a.savedAt) ? v : a), null);
  const own = versions.filter((v) => v.night != null && v.night === night && v.fromPull <= pull.pullNumber);
  if (own.length) return latest(own, (v) => v.fromPull);
  const before = versions.filter((v) => v.night != null && night != null && v.night < night);
  if (before.length) return latest(before, (v) => v.night ?? '');
  return latest(
    versions.filter((v) => v.night == null),
    (v) => v.savedAt,
  );
}
