import type { Positions, UnitPos } from '../types';
import { classColor, shortName } from '../lib/format';
import { useMessages } from '../i18n';
import { positionMapMsg } from './misc.i18n';

export type Mark = 'dead' | 'culprit';

/**
 * Estilos também em linha: o gerador de imagem (Compartilhar) não aplica fill/stroke de SVG
 * vindos de classes CSS.
 */
const STYLE = {
  ring: { fill: 'none', stroke: 'var(--border)', strokeDasharray: '3 3' },
  ringLabel: { fill: 'var(--muted)', fontSize: 9 },
  enemy: { fill: 'var(--wipe)', stroke: 'var(--bg)', strokeWidth: 1.5 },
  player: { stroke: 'var(--bg)', strokeWidth: 1.5 },
  dead: { fill: 'none', stroke: 'var(--wipe)', strokeWidth: 2.5 },
  culprit: { fill: 'none', stroke: 'var(--major)', strokeWidth: 2.5 },
  label: { fill: 'var(--muted)', fontSize: 10 },
  strong: { fill: 'var(--text)', fontSize: 10, fontWeight: 600 },
} as const;

interface Props {
  snap: Positions;
  /** guid -> classe (cor do ponto) */
  classes: Map<string, string | null>;
  /** destaque por guid */
  marks?: Map<string, Mark>;
  size?: number;
}

/** Posição mais velha que isso aparece apagada (o player pode ter andado). */
const STALE_MS = 2_000;
/** Menor área mostrada (jardas), para um grupo junto não virar um borrão. */
const MIN_SPAN = 30;

/** Distância entre duas unidades, em jardas. */
export const dist = (a: UnitPos, b: UnitPos) => Math.hypot(a.x - b.x, a.y - b.y);

/** Inimigo principal da foto (o primeiro é o de mais HP). */
export const mainEnemy = (snap: Positions) => snap.units.find((u) => u.kind === 'enemy') ?? null;

/**
 * Mini mapa visto de cima: players (cor da classe), bosses (losango) e anéis de 10 jardas em
 * volta do boss. Coordenadas relativas: a orientação pode não bater com a do jogo, mas as
 * distâncias batem.
 */
export function PositionMap({ snap, classes, marks, size = 240 }: Props) {
  const t = useMessages(positionMapMsg);
  const units = snap.units;
  if (units.length === 0) return null;
  const boss = mainEnemy(snap);

  const xs = units.map((u) => u.x);
  const ys = units.map((u) => u.y);
  const cx = boss ? boss.x : (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = boss ? boss.y : (Math.min(...ys) + Math.max(...ys)) / 2;
  // área quadrada em volta do centro que cabe todo mundo
  const reach = Math.max(MIN_SPAN / 2, ...units.map((u) => Math.max(Math.abs(u.x - cx), Math.abs(u.y - cy)))) * 1.12;
  const pad = 10;
  const scale = (size / 2 - pad) / reach;
  const sx = (u: { x: number }) => size / 2 + (u.x - cx) * scale;
  const sy = (u: { y: number }) => size / 2 - (u.y - cy) * scale;

  const rings = boss ? [10, 20, 30, 40].filter((r) => r <= reach) : [];
  const players = units.filter((u) => u.kind === 'player');
  const enemies = units.filter((u) => u.kind === 'enemy');
  // destacados por cima dos outros
  const order = (u: UnitPos) => (marks?.has(u.guid) ? 1 : 0);

  return (
    <svg className="posmap" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t.aria}>
      {rings.map((r) => (
        <g key={r}>
          <circle cx={sx(boss!)} cy={sy(boss!)} r={r * scale} className="posmap-ring" style={STYLE.ring} />
          <text x={sx(boss!) + r * scale * 0.71 + 2} y={sy(boss!) - r * scale * 0.71 - 2} className="posmap-ring-label" style={STYLE.ringLabel}>
            {r}
          </text>
        </g>
      ))}
      {enemies.map((e) => (
        <g key={e.guid}>
          <rect x={sx(e) - 6} y={sy(e) - 6} width={12} height={12} transform={`rotate(45 ${sx(e)} ${sy(e)})`} className="posmap-enemy" style={STYLE.enemy}>
            <title>{e.name}</title>
          </rect>
          <text x={sx(e)} y={sy(e) - 11} className="posmap-label" style={STYLE.label} textAnchor="middle">
            {e.name}
          </text>
        </g>
      ))}
      {[...players].sort((a, b) => order(a) - order(b)).map((p) => {
        const mark = marks?.get(p.guid);
        const d = boss ? t.distance(dist(p, boss).toFixed(0), boss.name) : '';
        return (
          <g key={p.guid} opacity={p.ageMs > STALE_MS && !mark ? 0.45 : 1}>
            {mark && <circle cx={sx(p)} cy={sy(p)} r={9} className={`posmap-mark ${mark}`} style={mark === 'dead' ? STYLE.dead : STYLE.culprit} />}
            <circle cx={sx(p)} cy={sy(p)} r={5} fill={classColor(classes.get(p.guid))} className="posmap-player" style={STYLE.player}>
              <title>{`${shortName(p.name)}${d}${p.ageMs > STALE_MS ? t.stale((p.ageMs / 1000).toFixed(1)) : ''}`}</title>
            </circle>
            {mark && (
              <text x={sx(p)} y={sy(p) + 19} className="posmap-label strong" style={STYLE.strong} textAnchor="middle">
                {shortName(p.name)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
