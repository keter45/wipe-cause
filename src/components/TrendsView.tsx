import { useEffect, useMemo, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { historyTrends, type HistoryEntry } from '../lib/api';
import { buildTrends, byGroup, trendBosses, type NightInput } from '../lib/trends';
import { bossKey } from '../lib/night';
import { withErrorBoundary } from './ErrorBoundary';
import { BossName } from './Names';
import { messagesOf, useMessages } from '../i18n';
import { trendsViewMsg } from './TrendsView.i18n';
import { TrendsBody } from './TrendsPanels';
import { ShareMenu } from './share/ShareMenu';
import { evolutionPosts } from '../lib/sharePosts';

/**
 * Evolução entre noites de um boss: progresso, causas de wipe por noite e o que se repete com
 * cada player. Usa todas as análises salvas no histórico.
 */
interface TrendsViewProps {
  /** noites salvas: o "Reanalisar as noites deste boss" usa o logPath de cada uma */
  history?: HistoryEntry[];
  /** roda o lote do "Analisar todos" (só no app) */
  onReanalyzeAll?: (paths: string[]) => Promise<void>;
  busy?: boolean;
  /** false no navegador, onde os logs locais não ficam disponíveis para reanalisar */
  canReanalyzeAll?: boolean;
}

function TrendsViewInner({ history = [], onReanalyzeAll, busy = false, canReanalyzeAll = false }: TrendsViewProps) {
  const t = useMessages(trendsViewMsg);
  const [nights, setNights] = useState<NightInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setError(null);
    historyTrends()
      .then((xs) => setNights(xs.map((x) => ({ id: x.id, title: x.title, raidStartMs: x.raidStartMs, pulls: x.report.pulls }))))
      .catch((e) => setError(String(e)));
  }, [reload]);

  async function reanalyzeAll() {
    setConfirming(false);
    if (!onReanalyzeAll || reanalyze.paths.length === 0) return;
    await onReanalyzeAll(reanalyze.paths);
    setReload((n) => n + 1);
  }

  // a Evolução é da raid da guilda; noites com outros personagens e gente aleatória ficam à parte
  const [withPug, setWithPug] = useState(false);
  const grouped = useMemo(() => (nights ? byGroup(nights, withPug ? 'all' : 'guild') : null), [nights, withPug]);
  const bosses = useMemo(() => (grouped ? trendBosses(grouped.nights) : []), [grouped]);
  // sem escolha: o boss com mais pulls entre os que têm duas noites (a progressão do momento)
  const busiest = [...bosses].sort((a, b) => b.pulls - a.pulls);
  const selected = boss ?? busiest.find((b) => b.nights >= 2)?.key ?? busiest[0]?.key ?? null;
  const bossName = bosses.find((b) => b.key === selected)?.name ?? selected ?? '';
  // logs locais que sumiram do disco ficam de fora (a mesma regra dos outros botões de reanalisar);
  // só entram as noites salvas que têm pulls do boss + dificuldade selecionados
  const reanalyze = useMemo(() => {
    const ids = new Set<string>();
    if (selected && nights) {
      for (const n of nights) {
        if (n.pulls.some((p) => bossKey(p) === selected)) ids.add(n.id);
      }
    }
    const paths: string[] = [];
    let skipped = 0;
    for (const e of history) {
      if (!ids.has(e.id)) continue;
      if (e.logExists) paths.push(e.logPath);
      else skipped++;
    }
    return { paths, skipped };
  }, [history, nights, selected]);
  // uma linha por dificuldade (Mythic, Heroic...), cada uma na ordem da raide
  const rows = useMemo(() => {
    const out: { id: number; name: string; bosses: typeof bosses }[] = [];
    for (const b of bosses) {
      const row = out.find((r) => r.id === b.difficultyId);
      if (row) row.bosses.push(b);
      else out.push({ id: b.difficultyId, name: b.difficultyName, bosses: [b] });
    }
    return out;
  }, [bosses]);
  const trends = useMemo(() => (grouped && selected ? buildTrends(grouped.nights, selected) : null), [grouped, selected]);

  return (
    <div className="night trends">
      <header className="night-head">
        <h2>{t.title}</h2>
        <span className="muted small">{t.subtitle}</span>
        <span className="topbar-spacer" />
        {canReanalyzeAll && onReanalyzeAll && (
          <button
            className="btn sm"
            disabled={busy || reanalyze.paths.length === 0}
            onClick={() => setConfirming(true)}
            title={t.reanalyzeBossTitle(bossName)}
          >
            <RotateCw size={14} strokeWidth={1.5} aria-hidden /> {t.reanalyzeBoss}
          </button>
        )}
        {trends && trends.nights.length > 0 && <ShareMenu posts={(detail) => evolutionPosts(trends, selected ?? bossName, detail)} />}
        {grouped && grouped.pugPulls > 0 && (
          <label className="trends-pug small" title={t.withPugTitle}>
            <input type="checkbox" checked={withPug} onChange={(e) => setWithPug(e.target.checked)} /> {t.withPug(grouped.pugPulls)}
          </label>
        )}
      </header>

      {confirming && (
        <div className="night-confirm trends-reanalyze-confirm">
          <p className="small">{t.reanalyzeBossConfirm(bossName, reanalyze.paths.length, reanalyze.skipped)}</p>
          <div className="night-actions">
            <button className="btn primary sm" disabled={busy} onClick={reanalyzeAll}>
              <RotateCw size={14} strokeWidth={1.5} aria-hidden /> {t.reanalyzeAllConfirm}
            </button>
            <button className="btn ghost sm" onClick={() => setConfirming(false)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{t.error(error)}</div>}
      {!nights && !error && <p className="muted">{t.reading}</p>}
      {nights && bosses.length === 0 && <p className="muted">{t.empty}</p>}

      {rows.length > 0 && (
        <div className="trends-bosses" role="tablist" aria-label={t.boss}>
          {rows.map((r) => (
            <div key={r.id} className="trends-difficulty">
              <span className="tile-label">{[14, 15, 16, 17].includes(r.id) ? r.name : t.otherDifficulty}</span>
              <div className="chips">
                {r.bosses.map((b) => (
                  <button key={b.key} role="tab" aria-selected={b.key === selected} className={b.key === selected ? 'active' : ''} onClick={() => setBoss(b.key)} title={b.key}>
                    <BossName encounterId={b.encounterId} name={b.name} size={16} />
                    <span className="muted">{t.nights(b.nights)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {trends && trends.nights.length < 2 && (
        <p className="muted">{t.oneNight(selected ?? '')}</p>
      )}
      {trends && trends.nights.length >= 1 && <TrendsBody tr={trends} />}
    </div>
  );
}

export const TrendsView = withErrorBoundary(TrendsViewInner, () => messagesOf(trendsViewMsg).errorScope);
