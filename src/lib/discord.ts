// Mensagens do Discord (webhook): um embed por pull ou por boss, com o mesmo veredito da tela.
// Limites do Discord: título 256, descrição 4096, 25 campos, valor de campo 1024, total 6000.

import type { Pull } from '../types';
import { mmss, pct, shortName } from './format';
import type { NightSummary } from './night';
import { analyzePull, lowestBossHp } from './verdict';
import { bossUrl } from './wcl';
import { assignmentsFor, checkAssignments } from './assignments';
import { messagesOf, tr } from '../i18n';
import { discordMsg } from './discord.i18n';

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export interface DiscordPayload {
  username: string;
  embeds: DiscordEmbed[];
}

const RED = 0xe05656;
const GREEN = 0x4cc38a;
const BLUE = 0x3987e5;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Linhas até caber no valor de um campo (sobra vira "+N"). */
function lines(items: string[], max = 1024): string {
  const out: string[] = [];
  let used = 0;
  for (const [i, it] of items.entries()) {
    const extra = messagesOf(discordMsg).more(items.length - i);
    if (used + it.length + 1 > max - extra.length - 1) {
      out.push(extra);
      break;
    }
    out.push(it);
    used += it.length + 1;
  }
  return out.join('\n');
}

function field(name: string, items: string[]) {
  return items.length ? [{ name, value: lines(items) }] : [];
}

/** Resumo de um pull: gatilho, erros de mecânica, mortes decisivas, defensivos e interrupts. */
export function pullPayload(p: Pull, wclCode?: string | null): DiscordPayload {
  const v = analyzePull(p);
  const t = messagesOf(discordMsg);
  const hp = lowestBossHp(p);
  const title = p.success
    ? `Kill · ${p.encounterName} ${p.difficultyName} (${mmss(p.durationMs)})`
    : `Wipe ${p.pullNumber} · ${p.encounterName} ${p.difficultyName}${hp != null ? ` — ${pct(hp)}` : ''}`;

  const mechanics = p.mechanics
    .filter((m) => m.failures > 0 && (m.severity === 'wipe' || m.severity === 'major'))
    .map((m) => {
      const who = m.players
        .filter((x) => !x.credit)
        .slice(0, 5)
        .map((x) => shortName(x.name));
      return `**${m.name}** — ${tr(m.summary) || `${m.failures}×`}${who.length ? `: ${who.join(', ')}` : ''}`;
    });
  const deaths = v.decisiveDeaths.map((d) => `${shortName(d.name)} (${mmss(d.t)}) — ${d.killingBlowMechanic ?? d.killingBlow?.spellName ?? '?'}`);
  const noDefensive = [...new Set(v.decisiveDeaths.filter((d) => d.defensivesRecent.length === 0 && d.defensivesAvailable.length > 0).map((d) => shortName(d.name)))];
  const assignments = assignmentsFor(p);
  const passed = p.enemySpells.filter((e) => e.interruptible && e.casts > 0).map((e) => t.passed(e.name, e.casts));
  for (const m of p.mechanics.filter((m) => m.kind === 'interrupt')) {
    const groups = assignments.get(m.key);
    const missed = groups?.length ? checkAssignments(m, groups).kickers.filter((k) => k.missed) : [];
    if (missed.length) passed.push(t.missedTurn(m.name, missed.map((k) => k.name).join(', ')));
  }

  const counted = p.deaths.filter((d) => !d.ignored).length;
  return {
    username: 'Wipe Cause',
    embeds: [
      {
        title: clip(title, 256),
        url: wclCode ? bossUrl(wclCode, p) : undefined,
        description: clip(v.headline, 4096),
        color: p.success ? GREEN : RED,
        fields: [
          ...field(t.mechanics, mechanics),
          ...field(t.deaths, deaths),
          ...field(t.noDefensive, noDefensive),
          ...field(t.interrupts, passed),
        ].slice(0, 25),
        footer: { text: t.footer(p.startLocal.split(' ')[1]?.slice(0, 5) ?? '', mmss(p.durationMs), counted) },
      },
    ],
  };
}

/** Resumo de um boss na noite: pulls, melhor pull, maiores causas e quem mais errou. */
export function bossPayload(title: string, s: NightSummary): DiscordPayload {
  const t = messagesOf(discordMsg);
  const causes = s.causes
    .filter((c) => c.triggers > 0)
    .slice(0, 6)
    .map((c) => t.cause(c.name, c.triggers, s.wipes, c.deaths));
  const villains = [...s.players]
    .filter((p) => p.villainScore > 0)
    .sort((a, b) => b.villainScore - a.villainScore)
    .slice(0, 5)
    .map((p) => t.villain(shortName(p.name), p.decisiveDeaths, p.mechanicErrors));
  const heroes = [...s.players]
    .filter((p) => p.pulls > 0)
    .sort((a, b) => b.heroScore - a.heroScore)
    .slice(0, 3)
    .map((p) => t.hero(shortName(p.name), p.cleanPulls, p.pulls));
  const best = s.kills ? 'Kill' : s.best ? t.bestPull(s.best.pull.pullNumber, pct(s.best.hp)) : '—';
  return {
    username: 'Wipe Cause',
    embeds: [
      {
        title: clip(t.summaryTitle(title), 256),
        description: t.summary(s.pulls.length, s.wipes, s.kills, best),
        color: s.kills ? GREEN : BLUE,
        fields: [...field(t.causes, causes), ...field(t.villains, villains), ...field(t.heroes, heroes)],
        footer: { text: t.gap(mmss(s.avgGapMs)) },
      },
    ],
  };
}
