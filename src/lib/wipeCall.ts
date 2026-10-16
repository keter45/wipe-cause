// Call de wipe (ver crates/wipe-core/src/wipecall.rs): o grupo desistiu da try e o resto morreu de
// propósito. O núcleo corta a análise nela; aqui ficam os textos que explicam o corte.

import type { Pull, WipeCallTrigger } from '../types';
import { mmss, shortName } from './format';
import { messagesOf } from '../i18n';
import { wipeCallMsg } from './wipeCall.i18n';

/** O que levou à call, numa frase ("o tank Reidane morreu para Gravebound aos 3:46 e não voltou"). */
export function triggerText(tr: WipeCallTrigger | undefined): string {
  const t = messagesOf(wipeCallMsg);
  if (!tr) return t.noTrigger;
  const at = mmss(tr.t);
  switch (tr.kind) {
    case 'tank':
      return t.tank(shortName(tr.name ?? '?'), tr.spell ?? null, at, !!tr.noRez);
    case 'mass':
      return t.mass(tr.spell ?? '?', tr.deaths, at);
    case 'mechanic':
      return t.mechanic(tr.spell ?? '?', at);
    default:
      return t.deaths(tr.deaths, at);
  }
}

/** Cabeçalho do pull ("call de wipe aos 3:55") e a explicação (dica e card da try). */
export function wipeCallText(p: Pull): { short: string; detail: string; explain: string; possible: boolean } | null {
  const c = p.wipeCall;
  // a call só explica o corte quando foi ela que cortou (uma possível depois do corte por mortes, não)
  if (!c || p.cutoffT !== c.t) return null;
  const t = messagesOf(wipeCallMsg);
  const possible = c.confidence === 'possible';
  return {
    short: t.short(possible, mmss(c.t)),
    detail: t.detail(possible, c.stopped, mmss(c.t), triggerText(c.trigger)),
    // no card da try, o título já diz o que levou à call
    explain: t.explain(c.stopped),
    possible,
  };
}
