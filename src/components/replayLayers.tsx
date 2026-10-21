// Peças do mapa do replay: a contagem de um aviso (arco que fecha e os segundos), o escudo e a vida
// de um inimigo, e os fragmentos no chão.

import { useMessages } from '../i18n';
import { num } from '../lib/format';
import type { ReplayData } from '../lib/replay';
import { unitAuraAt, type Countdown } from '../lib/replayTimers';
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

/** Fragmentos: a cor de alma, e quanto dura o estouro quando alguém pega (ms). */
const FRAGMENT_COLOR = '#67e8f9';
const PICKUP_POP_MS = 450;

/**
 * Fragmentos no chão até alguém pegar, brilhando (o dono no título; quantos faltam vai em cima dele). O
 * log não diz onde eles caem: cada um fica onde foi pego, desde que o dono ganhou o debuff.
 */
export function Pickups({ data, now, sx, sy, name, hidden }: { data: NonNullable<ReplayData['pickups']>; now: number; sx: (x: number) => number; sy: (y: number) => number; name: (guid: string) => string; hidden: Set<string> }) {
  const t = useMessages(replayMsg);
  return (
    <g className="replay-pickups">
      {data.items.map((p, i) => {
        const kind = data.kinds[p.kind];
        if (now < p.from || now >= p.at + PICKUP_POP_MS || !kind || hidden.has('pickup:' + kind.key)) return null;
        const [x, y] = [sx(p.x), sy(p.y)];
        if (now >= p.at) return <ImpactRing key={i} cx={x} cy={y} r={4} age={now - p.at} dur={PICKUP_POP_MS} color={FRAGMENT_COLOR} grow={3} />;
        // brilho que pulsa (pela hora do replay: o clipe e o slider desenham igual)
        const pulse = 0.5 + 0.5 * Math.sin((now - p.from) / 180);
        return (
          <g key={i} className="replay-pickup">
            <circle cx={x} cy={y} r={8 + 2.5 * pulse} fill={FRAGMENT_COLOR} fillOpacity={0.16 + 0.16 * pulse} />
            <circle cx={x} cy={y} r={4.2} fill={FRAGMENT_COLOR} stroke="#ecfeff" strokeWidth={1.2}>
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
export function Pools({ pools, now, sx, sy, scale, clip, hidden }: { pools: NonNullable<ReplayData['pools']>; now: number; sx: (x: number) => number; sy: (y: number) => number; scale: number; clip?: string; hidden: Set<string> }) {
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
          </g>
        );
      })}
    </g>
  );
}
