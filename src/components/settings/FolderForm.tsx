import { useEffect, useState } from 'react';
import { FolderOpen, FolderSearch } from 'lucide-react';
import { inTauri, pickFolder } from '../../lib/api';

export interface FolderApi {
  /** pasta cadastrada pelo usuário (null = detecção automática) */
  get: () => Promise<string | null>;
  set: (dir: string | null) => Promise<void>;
  /** pasta encontrada sozinha (instalação do WoW, configuração do Recorder…) */
  detect: () => Promise<string | null>;
  /** pasta em uso e o que tem nela */
  scan: () => Promise<{ dir: string | null; warning: string | null; found: string }>;
}

/**
 * Cadastro de uma pasta que varia de PC para PC: digitar, procurar ou voltar para a detectada.
 * `detectedLabel`: de onde vem a detecção ("instalação do WoW", "Warcraft Recorder").
 */
export function FolderForm({ api, pickTitle, placeholder, detectedLabel, onSaved }: { api: FolderApi; pickTitle: string; placeholder: string; detectedLabel: string; onSaved: () => void }) {
  const [path, setPath] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [scan, setScan] = useState<Awaited<ReturnType<FolderApi['scan']>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rescan = () =>
    api
      .scan()
      .then(setScan)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    if (!inTauri) return;
    api.get().then((d) => {
      setSaved(d);
      setPath(d ?? '');
    });
    api.detect().then(setDetected).catch(() => {});
    rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(dir: string | null) {
    setError(null);
    try {
      await api.set(dir);
      const clean = dir && dir.trim() ? dir.trim() : null;
      setSaved(clean);
      setPath(clean ?? '');
      await rescan();
      onSaved();
    } catch (e) {
      setError(String(e));
    }
  }

  async function browse() {
    const dir = await pickFolder(pickTitle);
    if (dir) await save(dir);
  }

  if (!inTauri) return <p className="muted small">Escolher pastas funciona só no app instalado.</p>;

  const using = saved ? 'escolhida por você' : scan?.dir ? `detectada (${detectedLabel})` : null;
  return (
    <>
      <div className="folder-status small">
        {scan?.dir ? (
          <>
            <div className="folder-path">
              <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> <code>{scan.dir}</code>
              {using && <span className="muted">· {using}</span>}
            </div>
            {scan.warning ? <div className="bad">{scan.warning}</div> : <div className="ok-text">{scan.found}</div>}
          </>
        ) : (
          <div className="muted">Nenhuma pasta definida{detected ? '' : `, e a ${detectedLabel} não foi encontrada neste PC`}.</div>
        )}
      </div>

      <label className="field">
        Caminho da pasta
        <span className="model-row">
          <input
            className="text-input"
            value={path}
            spellCheck={false}
            placeholder={detected ?? placeholder}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && path.trim() && save(path)}
          />
          <button className="btn sm" onClick={browse}>
            <FolderOpen size={14} strokeWidth={1.5} aria-hidden /> Procurar…
          </button>
        </span>
      </label>
      {error && <p className="small bad">{error}</p>}
      <div className="set-actions">
        {detected && saved && (
          <button className="btn ghost" onClick={() => save(null)} title={detected}>
            <FolderSearch size={14} strokeWidth={1.5} aria-hidden /> Usar a detectada
          </button>
        )}
        <button className="btn primary" onClick={() => save(path)} disabled={!path.trim() || path.trim() === saved}>
          Salvar
        </button>
      </div>
    </>
  );
}
