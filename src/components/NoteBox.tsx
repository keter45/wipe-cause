import { useEffect, useMemo, useState } from 'react';
import type { Pull } from '../types';
import { editNote, newVersion, noteFor, setFromPull, type NoteVersion } from '../lib/healNote';
import { useMessages } from '../i18n';
import { noteBoxMsg } from './NoteBox.i18n';

interface Props {
  /** um pull do boss (a note é por boss e dificuldade) */
  pull: Pull;
  nightPulls: Pull[];
  /** o relatório está ao vivo: versão nova começa no pull seguinte */
  live: boolean;
  versions: NoteVersion[];
  onChange: (v: NoteVersion[]) => void;
  placeholder?: string;
  rows?: number;
}

/**
 * A caixa da note do líder, a mesma na aba Interrupts e na seção de CDs de cura: grava a cada
 * mudança na versão mais nova e mostra as versões da noite com "a partir do pull N".
 */
export function NoteBox({ pull, nightPulls, live, versions, onChange, placeholder, rows = 8 }: Props) {
  const t = useMessages(noteBoxMsg);
  const newest = versions[versions.length - 1];
  const [draft, setDraft] = useState(newest?.text ?? '');
  // nova versão ou troca de boss: a caixa mostra o texto da mais nova
  useEffect(() => setDraft(newest?.text ?? ''), [newest?.savedAt, pull.encounterId, pull.difficultyId]);

  const judged = useMemo(() => {
    const n = new Map<number, number>();
    for (const p of nightPulls) {
      const v = noteFor(p, nightPulls, versions);
      if (v) n.set(v.savedAt, (n.get(v.savedAt) ?? 0) + 1);
    }
    return n;
  }, [nightPulls, versions]);
  const numbers = useMemo(() => [...new Set(nightPulls.map((p) => p.pullNumber))].sort((a, b) => a - b), [nightPulls]);
  const shown = versions.filter((v) => (judged.get(v.savedAt) ?? 0) > 0 || v === newest);

  return (
    <div className="assign-edit note-box">
      <textarea
        className="text-input"
        rows={rows}
        value={draft}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(editNote(pull, e.target.value, nightPulls, live));
        }}
      />
      {versions.length > 0 && (
        <div className="note-versions small">
          <span className="muted">{t.versions}:</span>
          {shown.map((v) => (
            <span key={v.savedAt} className="note-version">
              {t.version(versions.indexOf(v) + 1)}
              {v.night == null ? (
                <span className="muted"> ({t.noNight})</span>
              ) : (
                <>
                  {' '}
                  <label className="muted">
                    {t.fromPull}{' '}
                    <select className="text-input sm" value={v.fromPull} onChange={(e) => onChange(setFromPull(pull, v.savedAt, Number(e.target.value)))}>
                      {[...new Set([...numbers, v.fromPull])].sort((a, b) => a - b).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}{' '}
              {(judged.get(v.savedAt) ?? 0) > 0 ? <span className="muted">· {t.judges(judged.get(v.savedAt)!)}</span> : <span className="warn">· {t.judgesNone}</span>}
            </span>
          ))}
          <button className="btn ghost sm" title={t.newVersionHint} onClick={() => onChange(newVersion(pull, nightPulls, live))}>
            {t.newVersion}
          </button>
        </div>
      )}
    </div>
  );
}
