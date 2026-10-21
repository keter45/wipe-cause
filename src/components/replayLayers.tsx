// Peças do mapa do replay: a contagem de um aviso (arco que fecha e os segundos), o escudo e a vida
// de um inimigo, os fragmentos no chão, as poças, o CC dos players e os portais do warlock.

import { useMessages } from '../i18n';
import { num } from '../lib/format';
import type { ReplayData } from '../lib/replay';
import { countdown, unitAuraAt, type Countdown } from '../lib/replayTimers';
import { SvgSpellIcon } from './SpellIcon';
import type { UnitAuraView } from '../types';
import { replayMsg } from './ReplayView.i18n';

/** Arco em volta de (cx, cy) que fecha no sentido horário a partir do topo, conforme o aviso acaba. */
export function TimerArc({ cx, cy, r, cd, color }: { cx: number; cy: number; r: number; cd: Countdown; color?: string }) {
  const len = 2 * Math.PI * r;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      className="replay-timer"
      transform={`rotate(-90 ${cx} ${cy})`}
      // no style: o tracejado do contorno (soak, explosão) vem do CSS e passaria por cima de um atributo
      style={{ strokeDasharray: `${len * cd.left} ${len}`, ...(color ? { stroke: color } : {}) }}
      aria-hidden
    />
  );
}

/** Segundos que faltam, ao lado de um ícone. */
export function TimerTag({ x, y, cd, color, anchor = 'start' }: { x: number; y: number; cd: Countdown; color?: string; anchor?: 'start' | 'middle' | 'end' }) {
  const t = useMessages(replayMsg);
  return (
    <text x={x} y={y} textAnchor={anchor} className="replay-timer-tag num" style={color ? { fill: color } : undefined}>
      {t.secs(cd.leftMs)}
    </text>
  );
}

/** Cor do anel de escudo/véu num inimigo. */
const SHIELD_COLOR = '#a78bfa';
/** Barra de vida embaixo de um add (px). */
const ADD_HP_W = 26;
const ADD_HP_H = 3;

/**
 * Embaixo e em volta de um inimigo no mapa: o escudo ou véu dele (anel, stacks e quanto já absorveu) e,
 * num add que importa, a barra de vida.
 */
export function UnitStatus({ x, y, auras, now, hp }: { x: number; y: number; auras: UnitAuraView[]; now: number; hp: number | null }) {
  const t = useMessages(replayMsg);
  const shown = auras.map((a) => [a, unitAuraAt(a, now)] as const).filter((p): p is [UnitAuraView, { stacks: number; absorbed: number }] => p[1] != null);
  if (!shown.length && hp == null) return null;
  return (
    <g className="replay-unit-status">
      {shown.map(([a, s], i) => {
        const label = t.unitAura(a.name, s.stacks, s.absorbed);
        const r = 13 + i * 4;
        return (
          <g key={a.key}>
            <circle cx={x} cy={y} r={r} className="replay-unit-aura" style={{ stroke: SHIELD_COLOR }}>
              <title>{label}</title>
            </circle>
            {/* uma marquinha por stack, no topo do anel */}
            {s.stacks > 1 &&
              Array.from({ length: s.stacks }, (_, k) => {
                const ang = -Math.PI / 2 + (k - (s.stacks - 1) / 2) * 0.32;
                return <circle key={k} cx={x + Math.cos(ang) * r} cy={y + Math.sin(ang) * r} r={2.2} fill={SHIELD_COLOR} stroke="var(--bg)" strokeWidth={1} />;
              })}
            {s.absorbed > 0 && (
              <text x={x - r - 3} y={y + 3} textAnchor="end" className="replay-timer-tag num" style={{ fill: SHIELD_COLOR }}>
                {num(s.absorbed)}
              </text>
            )}
          </g>
        );
      })}
      {hp != null && (
        <g role="img" aria-label={t.hp(Math.round(hp))}>
          <title>{t.hp(Math.round(hp))}</title>
          <rect x={x - ADD_HP_W / 2} y={y + 10} width={ADD_HP_W} height={ADD_HP_H} rx={ADD_HP_H / 2} className="replay-hpbar-bg" />
          <rect x={x - ADD_HP_W / 2} y={y + 10} width={(Math.max(0, Math.min(100, hp)) / 100) * ADD_HP_W} height={ADD_HP_H} rx={ADD_HP_H / 2} className="replay-add-hp" />
        </g>
      )}
    </g>
  );
}

/** O que se pega no chão (regra `pickup`): a cor, e quanto dura o estouro quando alguém pega (ms). */
const PICKUP_COLOR = '#67e8f9';
const PICKUP_POP_MS = 450;

/**
 * O que alguém tem que pegar no chão (regra `pickup`, ex.: fragmentos), brilhando até ser pego (o dono
 * no título; quantos faltam vai ao lado dele). O log não diz onde essas coisas caem: cada uma fica onde
 * foi pega, desde que o dono ganhou o debuff.
 */
export function Pickups({ data, now, sx, sy, name, hidden, fx }: { data: NonNullable<ReplayData['pickups']>; now: number; sx: (x: number) => number; sy: (y: number) => number; name: (guid: string) => string; hidden: Set<string>; fx: boolean }) {
  const t = useMessages(replayMsg);
  return (
    <g className="replay-pickups">
      {data.items.map((p, i) => {
        const kind = data.kinds[p.kind];
        if (now < p.from || now >= p.at + PICKUP_POP_MS || !kind || hidden.has('pickup:' + kind.key)) return null;
        const [x, y] = [sx(p.x), sy(p.y)];
        if (now >= p.at) return fx ? <ImpactRing key={i} cx={x} cy={y} r={4} age={now - p.at} dur={PICKUP_POP_MS} color={PICKUP_COLOR} grow={3} /> : null;
        // brilho que pulsa (pela hora do replay: o clipe e o slider desenham igual)
        const pulse = fx ? 0.5 + 0.5 * Math.sin((now - p.from) / 180) : 0.5;
        return (
          <g key={i} className="replay-pickup">
            <circle cx={x} cy={y} r={8 + 2.5 * pulse} fill={PICKUP_COLOR} fillOpacity={0.16 + 0.16 * pulse} />
            <circle cx={x} cy={y} r={4.2} fill={PICKUP_COLOR} stroke="#ecfeff" strokeWidth={1.2}>
              <title>{t.pickup(kind.name, name(p.owner))}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}

/** Anel que sai de um ponto e some (impacto, orb que explode, fragmento pego): `age` ms desde o momento. */
export function ImpactRing({ cx, cy, r, age, dur, color, grow = 1.6 }: { cx: number; cy: number; r: number; age: number; dur: number; color: string; grow?: number }) {
  if (age < 0 || age > dur) return null;
  const k = age / dur;
  // sai rápido e desacelera
  const e = 1 - (1 - k) * (1 - k);
  return <circle cx={cx} cy={cy} r={r * (1 + (grow - 1) * e)} className="replay-impact" style={{ stroke: color, strokeOpacity: 0.9 * (1 - k), strokeWidth: 2.5 * (1 - k) + 0.5 }} aria-hidden />;
}

/** Setor do frontal na tela: do boss (bx, by) na direção `a` (radianos do mundo, y para cima), meio ângulo `h`, raio `len` px. */
export function sector(bx: number, by: number, a: number, h: number, len: number): string {
  const p = (t: number) => `${(bx + Math.cos(t) * len).toFixed(1)},${(by - Math.sin(t) * len).toFixed(1)}`;
  return `M${bx.toFixed(1)},${by.toFixed(1)}L${p(a + h)}A${len.toFixed(1)},${len.toFixed(1)} 0 0 1 ${p(a - h)}Z`;
}

/** Cor das poças de tamanho conhecido. */
const POOL_COLOR = '#2dd4bf';

/**
 * Poças de tamanho conhecido: anunciadas no cast (só o contorno tracejado), depois no chão (cheias),
 * crescendo no começo e recuando no fim.
 */
export function Pools({ pools, now, sx, sy, scale, clip, hidden, labels }: { pools: NonNullable<ReplayData['pools']>; now: number; sx: (x: number) => number; sy: (y: number) => number; scale: number; clip?: string; hidden: Set<string>; labels: boolean }) {
  const t = useMessages(replayMsg);
  return (
    <g className="replay-pools" clipPath={clip}>
      {pools.map((p, i) => {
        if (now < p.from || now >= p.to || hidden.has('pool:' + p.key)) return null;
        const coming = now < p.on;
        // cresce de 3/4 do tamanho até o cheio, e recua no fim
        const grow = p.growMs > 0 ? Math.min(1, (now - p.on) / p.growMs, (p.to - now) / p.growMs) : 1;
        const k = coming ? 1 : 0.75 + 0.25 * Math.max(0, grow);
        const label = coming ? t.poolComing(p.name, p.on - now) : p.name;
        return (
          <g key={`${p.key}-${i}`} className={`replay-pool-shape ${coming ? 'coming' : ''}`} style={{ color: POOL_COLOR }} opacity={coming ? 0.5 + 0.5 * ((now - p.from) / Math.max(1, p.on - p.from)) : 1}>
            {p.circles.map(([x, y, r], j) => (
              <circle key={j} cx={sx(x)} cy={sy(y)} r={r * k * scale}>
                <title>{label}</title>
              </circle>
            ))}
            {/* vindo: "Defiled Ground em 3,2s" entre as poças, em cima */}
            {coming && labels && (
              <text
                x={p.circles.reduce((a, c) => a + sx(c[0]), 0) / p.circles.length}
                y={Math.min(...p.circles.map((c) => sy(c[1]) - c[2] * scale)) + 16}
                textAnchor="middle"
                className="replay-timer-tag replay-pool-tag"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** CC de um player no mapa (coordenadas do mapa): em volta de onde ele estava, ou no inimigo alvo. */
export interface CcView {
  t: number;
  end: number;
  spellId: number;
  name: string;
  caster: string;
  casterName: string;
  x?: number;
  y?: number;
  radius?: number;
  target?: string;
}

/** Portal do warlock no mapa: as duas pontas, o cast e cada passagem. */
export interface GatewayView {
  caster?: string;
  casterName?: string;
  castFrom?: number;
  castAt?: number;
  from: number;
  to: number;
  a?: [number, number];
  b?: [number, number];
  uses: { t: number; guid: string }[];
}

/** O CC aparece por inteiro até isto (ms) e depois só o contorno, até acabar. */
const CC_FLASH_MS = 600;
/** Anel em volta do inimigo preso por um CC de alvo (px). */
const CC_RING_PX = 14;

/**
 * Controle de grupo: a área em volta de quem usou (ou do alvo, no Gorefiend's Grasp), que pisca no
 * instante e fica até acabar, com "quem: o quê" em cima; num CC de alvo, um anel no inimigo com o
 * tempo que falta.
 */
export function CcLayer({ cc, now, sx, sy, scale, color, enemyAt, fx }: { cc: CcView[]; now: number; sx: (x: number) => number; sy: (y: number) => number; scale: number; color: (guid: string) => string; enemyAt: (guid: string, t: number) => [number, number] | null; fx: boolean }) {
  return (
    <g className="replay-cc">
      {cc.map((c, i) => {
        if (now < c.t || now >= c.end) return null;
        const col = color(c.caster);
        // onde: a área fixa (onde ele estava, ou o alvo no instante do cast) ou o inimigo agora
        const fixed = c.x != null && c.y != null ? ([c.x, c.y] as [number, number]) : c.radius && c.target ? enemyAt(c.target, c.t) : null;
        const at = fixed ?? (c.target ? enemyAt(c.target, now) : null);
        if (!at) return null;
        const [x, y] = [sx(at[0]), sy(at[1])];
        const flash = Math.max(0, 1 - (now - c.t) / CC_FLASH_MS);
        const r = c.radius ? c.radius * scale : CC_RING_PX;
        const cd = countdown(c.t, c.end, now);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r} className={`replay-cc-area ${c.radius ? '' : 'ring'}`} style={{ stroke: col, fill: col, fillOpacity: c.radius ? 0.06 + 0.24 * flash : 0 }}>
              <title>{`${c.casterName}: ${c.name}`}</title>
            </circle>
            {!c.radius && cd && <TimerArc cx={x} cy={y} r={r + 3} cd={cd} color={col} />}
            {fx && <ImpactRing cx={x} cy={y} r={r} age={now - c.t} dur={CC_FLASH_MS} color={col} grow={1.4} />}
            <text x={x} y={y - r - 4} textAnchor="middle" className="replay-timer-tag replay-cc-tag">
              <tspan style={{ fill: col }}>{c.casterName}</tspan>
              {`: ${c.name}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Pontas do portal: verde (onde o warlock estava) e roxa (a outra). */
const GATE_COLORS = ['#4ade80', '#c084fc'];
/** Raio de cada ponta (jd) e o mínimo na tela (px). */
const GATE_YD = 1.8;
const GATE_MIN_PX = 5;
/** Quem passou: o anel que sai das duas pontas (ms). */
const GATE_USE_MS = 700;

/**
 * Portais do warlock: as duas pontas ligadas por um tracejado, com "portal de X" embaixo; o warlock
 * castando (ícone e barra em cima dele) e um anel nas pontas quando alguém passa.
 */
export function Gateways({ gates, now, sx, sy, scale, posOf, fx }: { gates: GatewayView[]; now: number; sx: (x: number) => number; sy: (y: number) => number; scale: number; posOf: (guid: string, t: number) => [number, number] | null; fx: boolean }) {
  const t = useMessages(replayMsg);
  return (
    <g className="replay-gates">
      {gates.map((g, i) => {
        // o warlock castando: o ícone e a barra em cima dele
        if (g.caster && g.castFrom != null && g.castAt != null && now >= g.castFrom && now < g.castAt) {
          const p = posOf(g.caster, now);
          if (!p) return null;
          const [x, y] = [sx(p[0]), sy(p[1])];
          const k = (now - g.castFrom) / Math.max(1, g.castAt - g.castFrom);
          return (
            <g key={i}>
              <SvgSpellIcon spellId={GATEWAY_SPELL} x={x - 7} y={y - 30} size={14} title={t.gateCasting(g.casterName ?? '')} />
              <rect x={x - 14} y={y - 13} width={28} height={3} rx={1.5} className="replay-castbar-bg" />
              <rect x={x - 14} y={y - 13} width={28 * k} height={3} rx={1.5} className="replay-castbar" />
            </g>
          );
        }
        if (now < g.from || now >= g.to) return null;
        const ends = [g.a, g.b].map((e) => (e ? ([sx(e[0]), sy(e[1])] as [number, number]) : null));
        const label = g.casterName ? t.gateOf(g.casterName) : t.gate;
        const r = Math.max(GATE_MIN_PX, GATE_YD * scale);
        const used = g.uses.filter((u) => now >= u.t && now - u.t <= GATE_USE_MS);
        return (
          <g key={i}>
            {ends[0] && ends[1] && <line x1={ends[0][0]} y1={ends[0][1]} x2={ends[1][0]} y2={ends[1][1]} className="replay-gate-link" />}
            {ends.map((e, j) =>
              e ? (
                <g key={j}>
                  <circle cx={e[0]} cy={e[1]} r={r} className="replay-gate" style={{ stroke: GATE_COLORS[j], fill: GATE_COLORS[j] }}>
                    <title>{label}</title>
                  </circle>
                  <text x={e[0]} y={e[1] + r + 10} textAnchor="middle" className="replay-timer-tag replay-gate-tag">
                    {label}
                  </text>
                  {fx && used.map((u) => <ImpactRing key={u.t} cx={e[0]} cy={e[1]} r={r} age={now - u.t} dur={GATE_USE_MS} color={GATE_COLORS[j]} grow={2.4} />)}
                </g>
              ) : null,
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Demonic Gateway (o ícone do cast). */
const GATEWAY_SPELL = 111771;
