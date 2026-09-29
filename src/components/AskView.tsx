import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, ExternalLink, FileText, RotateCcw, Send, Settings2 } from 'lucide-react';
import type { Pull } from '../types';
import { inTauri, openExternal } from '../lib/api';
import { PRESETS, aiChat, aiGetConfig, aiListModels, aiSetConfig, type AiConfig, type ChatMessage } from '../lib/ai';
import { SUGGESTED, SYSTEM_PROMPT, estimateTokens, pullContext } from '../lib/aiContext';
import { spellIndex } from '../lib/spells';
import { SpellName } from './SpellIcon';

/** Conversas por pull (sobrevivem à troca de aba enquanto o app está aberto). */
const conversations = new Map<string, ChatMessage[]>();
const convKey = (p: Pull) => `${p.encounterId}:${p.startMs}`;
/** Mensagens anteriores mandadas junto (o dossiê vai sempre). */
const HISTORY = 10;

/** "Perguntar à IA": conversa sobre este pull, com o dossiê da luta como contexto. */
export function AskView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const [config, setConfig] = useState<AiConfig | null | undefined>(undefined);
  const [settings, setSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => conversations.get(convKey(pull)) ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => pullContext(pull, nightPulls), [pull, nightPulls]);
  const spells = useMemo(() => spellIndex(pull), [pull]);

  useEffect(() => {
    // navegador (dev): conversa de exemplo; ?demoAiSetup=1 mostra a configuração
    if (!inTauri) return setConfig(new URLSearchParams(window.location.search).has('demoAiSetup') ? null : { provider: 'demo', baseUrl: '', model: 'demonstração', hasKey: true });
    aiGetConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);
  useEffect(() => {
    setMessages(conversations.get(convKey(pull)) ?? []);
    setError(null);
  }, [pull]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);

  function update(next: ChatMessage[]) {
    conversations.set(convKey(pull), next);
    setMessages(next);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: q }];
    update(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const system: ChatMessage = { role: 'system', content: `${SYSTEM_PROMPT}\n\n# Dossiê do pull\n${context}` };
      const answer = inTauri ? await aiChat([system, ...next.slice(-HISTORY)]) : await demoAnswer(q);
      update([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (config === undefined) return <p className="muted pad">Carregando…</p>;
  if (config === null || settings) {
    return (
      <AiSettings
        current={config}
        onCancel={config ? () => setSettings(false) : undefined}
        onSaved={(c) => {
          setConfig(c);
          setSettings(false);
        }}
      />
    );
  }

  const preset = PRESETS.find((x) => x.id === config.provider);
  return (
    <div className="ask">
      <header className="ask-head">
        <span className="small muted">
          <Bot size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {preset?.label ?? config.provider} · {config.model || 'modelo padrão'}
        </span>
        <span className="small muted" title="Tamanho aproximado do dossiê enviado a cada pergunta">
          contexto ≈ {Math.round(estimateTokens(context) / 100) / 10} mil tokens
        </span>
        <span className="head-actions">
          <button className="btn ghost sm" onClick={() => setShowContext(!showContext)} aria-expanded={showContext}>
            <FileText size={14} strokeWidth={1.5} aria-hidden /> {showContext ? 'Esconder dossiê' : 'Ver dossiê'}
          </button>
          {messages.length > 0 && (
            <button className="btn ghost sm" onClick={() => update([])}>
              <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> Nova conversa
            </button>
          )}
          {inTauri && (
            <button className="btn ghost sm" onClick={() => setSettings(true)}>
              <Settings2 size={14} strokeWidth={1.5} aria-hidden /> Configurar
            </button>
          )}
        </span>
      </header>

      {showContext && <pre className="ask-context">{context}</pre>}

      <div className="ask-thread">
        {messages.length === 0 && (
          <div className="ask-empty">
            <p className="muted small">
              A IA recebe um dossiê deste pull (mecânicas do boss com as dicas, mortes, defensivos, posições, escala de interrupts e notas) e
              responde só com base nele.
            </p>
            <div className="ask-suggestions">
              {SUGGESTED.map((s) => (
                <button key={s} className="btn ghost sm" onClick={() => ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} spells={spells} /> : <p>{m.content}</p>}
          </div>
        ))}
        {busy && <div className="ask-msg assistant muted">Analisando o pull…</div>}
        {error && <p className="small bad">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="ask-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          className="text-input"
          rows={2}
          value={input}
          placeholder="Pergunte sobre este pull… (Enter envia, Shift+Enter quebra linha)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          <Send size={14} strokeWidth={1.75} aria-hidden /> Perguntar
        </button>
      </form>
      <p className="muted small">O dossiê (com os nomes dos players) vai para o provedor escolhido a cada pergunta. A IA pode errar: confira no log.</p>
    </div>
  );
}

/** Navegador (desenvolvimento da UI): resposta de exemplo, sem chamar provedor. */
async function demoAnswer(q: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 500));
  return `**Modo navegador** — resposta de exemplo para: _${q}_\n\n- No app, a pergunta vai para o provedor configurado junto com o dossiê do pull.\n- Exemplo com habilidades: a **Virulent Mutation (detonação)** matou 4; ninguém usou defensivo contra Venom Rupture.\n- Use **Ver dossiê** para conferir o que a IA recebe.`;
}

// ---------------------------------------------------------------------------
// Configuração do provedor

function AiSettings({ current, onSaved, onCancel }: { current: AiConfig | null; onSaved: (c: AiConfig) => void; onCancel?: () => void }) {
  const [provider, setProvider] = useState(current?.provider ?? 'gemini');
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
      }
      const saved = await aiGetConfig();
      if (!test && saved) onSaved(saved);
      else if (saved) setKey('');
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const needsKey = preset.keyUrl != null;
  const keySaved = same && current?.hasKey;
  return (
    <div className="panel ai-settings">
      <h3>
        <Bot size={16} strokeWidth={1.5} className="inline-icon" aria-hidden /> Perguntar à IA — escolha o provedor
      </h3>
      <p className="muted small">Todos têm opção gratuita. A chave fica guardada no cofre de credenciais do Windows, não em arquivo.</p>

      <div className="segmented wrap" role="radiogroup" aria-label="Provedor">
        {PRESETS.map((p) => (
          <button key={p.id} role="radio" aria-checked={provider === p.id} className={provider === p.id ? 'active' : ''} onClick={() => pick(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="small">{preset.note}</p>

      {needsKey && (
        <label className="field">
          Chave de API
          <input
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={keySaved ? '•••••••• (salva — deixe vazio para manter)' : 'cole a chave aqui'}
            onChange={(e) => setKey(e.target.value)}
          />
          {preset.keyUrl && (
            <button type="button" className="link small" onClick={() => openExternal(preset.keyUrl!)}>
              Criar chave grátis <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </label>
      )}
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

      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>{msg.text}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={() => save(true)} disabled={busy || !model || (needsKey && !key && !keySaved)}>
          Testar
        </button>
        <span className="topbar-spacer" />
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn primary" onClick={() => save(false)} disabled={busy || !model || !baseUrl || (needsKey && !key && !keySaved)}>
          Salvar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown mínimo das respostas (sem HTML: parágrafos, listas, títulos, **negrito**, _itálico_, `código`)

type Spells = Map<string, number> | undefined;

/** Troca nomes de habilidades conhecidas (do pull) por ícone + nome. */
function withIcons(text: string, spells: Spells, keyBase: string): ReactNode[] {
  if (!spells?.size) return [text];
  const names = [...spells.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}])(${names.join('|')})(?![\\p{L}])`, 'giu');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<SpellName key={`${keyBase}-${m.index}`} spellId={spells.get(m[0].normalize('NFC').toLocaleLowerCase('en'))} name={m[0]} size={16} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, spells: Spells): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(...withIcons(text.slice(last, m.index), spells, `t${last}`));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={m.index}>{withIcons(t.slice(2, -2), spells, `b${m.index}`)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    else out.push(<em key={m.index}>{withIcons(t.slice(1, -1), spells, `i${m.index}`)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(...withIcons(text.slice(last), spells, `t${last}`));
  return out;
}

/** `spells`: nome (minúsculas) -> spell, para mostrar o ícone ao lado das habilidades citadas. */
export function Markdown({ text, spells }: { text: string; spells?: Map<string, number> }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, spells)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(h ? <h4 key={blocks.length}>{inline(h[1], spells)}</h4> : <p key={blocks.length}>{inline(line, spells)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}
