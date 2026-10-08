import { useState } from 'react';
import { Radio, Square } from 'lucide-react';
import { sourceName, type LiveStatus } from '../lib/api';
import { Popover } from './Popover';
import { useMessages } from '../i18n';
import { liveControlsMsg } from './LiveControls.i18n';

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

// ---------------------------------------------------------------------------
// Ao vivo

export function LiveButton({ status, error, onStart, onStop }: { status: LiveStatus; error: string | null; onStart: () => void; onStop: () => void }) {
  const [open, setOpen] = useState(false);
  const t = useMessages(liveControlsMsg);

  if (!status.active) {
    return (
      <div className="live-off">
        <button className="btn ghost" onClick={onStart} title={t.startTitle} aria-label={t.live}>
          <Radio {...ICON} /> <span className="topbar-label">{t.live}</span>
        </button>
        {error && (
          <span className="small bad live-error" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  const label = status.state === 'in_combat' && status.encounter ? t.inCombatWith(status.encounter) : t.state[status.state];
  const fileName = status.file ? sourceName(status.file) : null;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t.liveMode}
      trigger={
        <button className={`btn ghost live-on ${status.state} ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${t.live}: ${label}`}>
          <span className="live-dot" aria-hidden />
          <span className="topbar-label">{t.live}</span> <span className="small muted live-state">{label}</span>
        </button>
      }
    >
      <h4>{t.liveMode}</h4>
      <p className="muted small">{t.following(fileName ? <code>{fileName}</code> : t.guildOnWcl)}</p>
      <p className="small">{t.analyzed(status.analyzed)}</p>
      {status.message && <p className={`small ${status.state === 'error' ? 'bad' : 'muted'}`}>{status.message}</p>}
      <div className="popover-footer">
        <span className="topbar-spacer" />
        <button
          className="btn sm"
          onClick={() => {
            setOpen(false);
            onStop();
          }}
        >
          <Square size={12} strokeWidth={2} aria-hidden /> {t.stop}
        </button>
      </div>
    </Popover>
  );
}
