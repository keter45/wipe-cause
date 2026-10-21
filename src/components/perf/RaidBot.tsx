import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Play, RotateCcw, X } from 'lucide-react';
import type { Pull } from '../../types';
import { classColor, shortName } from '../../lib/format';
import { simcCancel, simcStatus } from '../../lib/api';
import { loadPotentials, raidCandidates, simulateRaid, type RaidPotential, type RaidProgress } from '../../lib/botRaid';
import { useMessages } from '../../i18n';
import { botMsg } from './bot.i18n';
import { Hint } from '../ui/Hint';

const tone = (pct: number) => (pct >= 0.97 ? 'good' : pct >= 0.85 ? 'warn' : 'bad');

/** Resumo do boss: simular a raide toda e o % do potencial de cada um, em barras. */
export function RaidBot({ pulls }: { pulls: Pull[] }) {
  const msg = useMessages(botMsg);
  const t = msg.raid;
  const ref = pulls[0] ?? null;
  const names = useMemo(() => (ref ? raidCandidates(pulls, ref) : []), [pulls, ref]);
  const [available, setAvailable] = useState(false);
  const [list, setList] = useState<RaidPotential[]>([]);
  const [progress, setProgress] = useState<RaidProgress | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const stop = useRef(false);

  useEffect(() => {
    simcStatus()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, []);
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    loadPotentials(pulls, ref, names).then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [pulls, ref, names, version]);

  if (!ref || names.length === 0) return null;
  const done = new Set(list.map((x) => x.name));
  const missing = names.filter((n) => !done.has(n));

  async function run(which: string[]) {
    stop.current = false;
    setFailed([]);
    const r = await simulateRaid(pulls, ref!, which, setProgress, () => stop.current, () => setVersion((v) => v + 1));
    setProgress(null);
    setFailed(r.failed.map((f) => shortName(f.name)));
    setVersion((v) => v + 1);
  }

  const busy = progress != null;
  const sorted = [...list].sort((a, b) => b.pct - a.pct);
  const max = Math.max(1.1, ...sorted.map((x) => x.pct));
  const classOf = (name: string) => pulls.flatMap((p) => p.players).find((p) => p.name === name)?.class ?? null;
  return (
    <section className="panel raid-bot">
      <div className="raid-bot-head">
        <Bot size={18} strokeWidth={1.5} className="muted" aria-hidden />
        <h3>
          {t.title} <Hint>{t.hint}</Hint>
        </h3>
        <span className="muted small">{t.count(list.length, names.length)}</span>
        <span className="raid-bot-actions">
          {busy ? (
            <button
              className="btn"
              onClick={() => {
                stop.current = true;
                void simcCancel();
              }}
            >
              <X size={14} strokeWidth={1.5} aria-hidden /> {msg.cancel}
            </button>
          ) : missing.length > 0 ? (
            <button className="btn primary" onClick={() => void run(missing)} disabled={!available} title={available ? undefined : t.appOnly}>
              <Play size={14} strokeWidth={1.5} aria-hidden /> {t.missing(missing.length)}
            </button>
          ) : (
            <button className="btn" onClick={() => void run(names)} disabled={!available} title={available ? undefined : t.appOnly}>
              <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> {t.all}
            </button>
          )}
        </span>
      </div>
      {progress && (
        <div className="raid-bot-progress" role="status">
          <span className="small">{t.running(shortName(progress.name), progress.index + 1, progress.total)}</span>
          <span className="bot-gauge-track">
            <span className="raid-bot-fill" style={{ width: `${(progress.index / progress.total) * 100}%` }} />
          </span>
        </div>
      )}
      {sorted.length === 0 ? (
        !busy && <p className="muted small">{t.empty}</p>
      ) : (
        <ul className="plain raid-bot-bars">
          {sorted.map((x) => (
            <li key={x.name}>
              <span className="raid-bot-name" style={{ color: classColor(classOf(x.name)) }}>
                {shortName(x.name)}
              </span>
              <span className="raid-bot-track">
                <span className={`raid-bot-bar ${tone(x.pct)}`} style={{ width: `${(x.pct / max) * 100}%` }} />
                <span className="raid-bot-mean" style={{ left: `${(1 / max) * 100}%` }} />
              </span>
              <span className={`raid-bot-pct small ${tone(x.pct)}`}>{Math.round(x.pct * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && <p className="muted small">{t.failed(failed.join(', '))}</p>}
    </section>
  );
}

