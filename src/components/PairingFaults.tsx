import { Fragment, useMemo, useState } from 'react';
import type { MechanicResult, PairFault } from '../types';
import { mmss } from '../lib/format';
import { fromLegacy, isLegacyReplay, type ReplayData } from '../lib/replay';
import { ReplayView } from './ReplayView';
import { useSeek } from '../lib/wcr';
import { useMessages } from '../i18n';
import { PlayerName } from './Names';
import { PlayAt } from './VideoPanel';
import { pairingMsg } from './PairingFaults.i18n';

type Classes = Map<string, string | null>;

/** Debuff de parear (Helical Toxins): cada encontro com soma errada, quem andou até quem e o replay. */
export function PairingFaults({ m, classes, data }: { m: MechanicResult; classes: Classes; data: ReplayData }) {
  const t = useMessages(pairingMsg);
  const faults = m.pairings ?? [];
  const [open, setOpen] = useState<number | null>(null);
  if (faults.length === 0) return null;
  return (
    <div className="pairings">
      <span className="muted small">{t.title}</span>
      <ul className="plain pairing-list">
        {faults.map((f, i) => (
          <li key={f.t} className={f.counted ? '' : 'harmless'}>
            <PairLine f={f} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
            {open === i && <PairReplay f={f} classes={classes} data={data} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PairLine({ f, open, onToggle }: { f: PairFault; open: boolean; onToggle: () => void }) {
  const t = useMessages(pairingMsg);
  const seek = useSeek();
  const culprit = f.members.find((x) => x.guid === f.culprit);
  const others = f.members.filter((x) => x.guid !== f.culprit);
  const tag = f.over ? (f.broke === false ? `${t.over(f.target)} · ${t.overAlready}` : t.over(f.target)) : f.broke ? t.broke : f.broke === false ? t.harmless : t.unknownStacks;
  return (
    <div className="pairing-line">
      <div className="pairing-main">
        <span className="muted num">{mmss(f.t)}</span>
        <span className="pairing-sum">
          {f.members.map((x, i) => (
            <Fragment key={x.guid}>
              {i > 0 && ' + '}
              <PlayerName name={x.name} guid={x.guid} /> <span className="stack-pill">{x.before ?? '?'}</span>
            </Fragment>
          ))}{' '}
          = <span className={`stack-pill ${f.counted ? 'bad' : ''}`}>{f.sum}</span>
        </span>
        <span className={`chip ${f.counted ? 'bad' : ''}`}>{tag}</span>
      </div>
      <div className="pairing-why small" title={t.walkedTitle}>
        {culprit ? (
          <>
            <PlayerName name={culprit.name} guid={culprit.guid} /> {t.wentTo}{' '}
            {others.map((x, i) => (
              <Fragment key={x.guid}>
                {i > 0 && ' + '}
                <PlayerName name={x.name} guid={x.guid} />
              </Fragment>
            ))}{' '}
            <span className="muted">{t.approachPct(Math.round(culprit.share * 100))}</span>
          </>
        ) : (
          <span className="muted">{t.bothMoved}</span>
        )}
      </div>
      {f.members.some((x) => x.better) && (
        <div className="pairing-why small muted">
          {f.members
            .filter((x) => x.better)
            .map((x, i) => (
              <span key={x.guid}>
                {i > 0 && ' · '}
                <PlayerName name={x.name} guid={x.guid} /> {t.needed(x.better!.stacks)} <PlayerName name={x.better!.name} guid={x.better!.guid} /> {t.nearest(x.better!.distYd.toFixed(0))}
              </span>
            ))}
        </div>
      )}
      <div className="pairing-actions">
        {f.replay && (
          <button className="link small" onClick={onToggle} aria-expanded={open}>
            {t.replay(open)}
          </button>
        )}
        <PlayAt t={f.t} seek={seek} />
      </div>
    </div>
  );
}

/** Replay do encontro (relatórios da v0.21.0 trazem as posições dentro do próprio replay). */
function PairReplay({ f, classes, data }: { f: PairFault; classes: Classes; data: ReplayData }) {
  const r = f.replay!;
  const legacy = useMemo(() => (isLegacyReplay(r) ? fromLegacy(r, f.t) : null), [r, f.t]);
  if (legacy) return <ReplayView data={legacy.data} replay={legacy.replay} classes={classes} moment="touch" />;
  if (isLegacyReplay(r)) return null;
  return <ReplayView data={data} replay={r} classes={classes} moment="touch" />;
}
