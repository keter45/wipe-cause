import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternal } from '../../lib/api';
import { PRESETS, aiChat, aiGetConfig, aiListModels, aiSetConfig, type AiConfig } from '../../lib/ai';

/** Provedor do "Perguntar à IA": todos com opção gratuita; a chave fica no cofre do Windows. */
export function AiForm({ current, onSaved }: { current: AiConfig | null; onSaved: () => void }) {
  const [provider, setProvider] = useState(current?.provider && current.provider !== 'demo' ? current.provider : 'gemini');
  const preset = PRESETS.find((p) => p.id === provider) ?? PRESETS[0];
  const same = current?.provider === provider;
  const [baseUrl, setBaseUrl] = useState(same ? current!.baseUrl : preset.baseUrl);
  const [model, setModel] = useState(same ? current!.model : preset.model);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setProvider(id);
    const keep = current?.provider === id;
    setBaseUrl(keep ? current!.baseUrl : p.baseUrl);
    setModel(keep ? current!.model : p.model);
    setModels([]);
    setMsg(null);
  }

  async function loadModels() {
    setBusy(true);
    setMsg(null);
    try {
      const list = await aiListModels(provider, baseUrl, key);
      setModels(list);
      setMsg({ ok: true, text: `${list.length} modelos disponíveis: escolha na lista do campo "Modelo".` });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function save(test: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const cfg: AiConfig = { provider, baseUrl, model, hasKey: current?.hasKey ?? false };
      await aiSetConfig(cfg, key ? key : undefined);
      if (test) {
        const r = await aiChat([{ role: 'user', content: 'Responda só: ok' }]);
        setMsg({ ok: true, text: `Conectado. Resposta do modelo: "${r.trim().slice(0, 60)}"` });
      } else {
        setMsg({ ok: true, text: 'Salvo.' });
      }
      if (await aiGetConfig()) {
        setKey('');
        onSaved();
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const needsKey = preset.keyUrl != null;
  const keySaved = same && current?.hasKey;
  const ready = !!model && !!baseUrl && (!needsKey || !!key || !!keySaved);
  return (
    <>
      <div className="segmented wrap" role="radiogroup" aria-label="Provedor">
        {PRESETS.map((p) => (
          <button key={p.id} role="radio" aria-checked={provider === p.id} className={provider === p.id ? 'active' : ''} onClick={() => pick(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="small set-note">{preset.note}</p>

      {needsKey && (
        <label className="field">
          <span className="field-label">
            Chave de API
            {preset.keyUrl && (
              <button type="button" className="link small" onClick={() => openExternal(preset.keyUrl!)}>
                Criar chave grátis <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </span>
          <input
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={keySaved ? '•••••••• (salva — deixe vazio para manter)' : 'cole a chave aqui'}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      )}
      <div className="field-row">
        <label className="field">
          URL da API
          <input className="text-input" value={baseUrl} spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="field">
          Modelo
          <span className="model-row">
            <input className="text-input" list="ai-models" value={model} spellCheck={false} placeholder="nome do modelo" onChange={(e) => setModel(e.target.value)} />
            <button type="button" className="btn sm" onClick={loadModels} disabled={busy || !baseUrl}>
              Carregar modelos
            </button>
          </span>
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>

      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="set-actions">
        <button className="btn" onClick={() => save(true)} disabled={busy || !ready}>
          Salvar e testar
        </button>
        <button className="btn primary" onClick={() => save(false)} disabled={busy || !ready}>
          Salvar
        </button>
      </div>
      <p className="muted small">O dossiê do pull (com os nomes dos players) vai para o provedor escolhido a cada pergunta.</p>
    </>
  );
}
