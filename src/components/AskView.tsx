import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, FileText, RotateCcw, Send, Settings2 } from 'lucide-react';
import type { Pull } from '../types';
import { inTauri } from '../lib/api';
import { PRESETS, aiChat, type ChatMessage } from '../lib/ai';
import { useSetup } from '../lib/setup';
import { dossierTitle, estimateTokens, pullContext, suggestedQuestions, systemPrompt } from '../lib/aiContext';
import { messagesOf, useMessages } from '../i18n';
import { askMsg } from './AskView.i18n';
import { spellIndex } from '../lib/spells';
import { SpellName } from './SpellIcon';
import { withPlayerNames } from './Names';
import { namesRegex, usePlayerClasses } from '../lib/players';

/** Conversas por pull (sobrevivem à troca de aba enquanto o app está aberto). */
const conversations = new Map<string, ChatMessage[]>();
const convKey = (p: Pull) => `${p.encounterId}:${p.startMs}`;
/** Mensagens anteriores mandadas junto (o dossiê vai sempre). */
const HISTORY = 10;

/** "Perguntar à IA": conversa sobre este pull, com o dossiê da luta como contexto. */
export function AskView({ pull, nightPulls }: { pull: Pull; nightPulls: Pull[] }) {
  const { status, openSettings } = useSetup();
  const t = useMessages(askMsg);
  const [messages, setMessages] = useState<ChatMessage[]>(() => conversations.get(convKey(pull)) ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => pullContext(pull, nightPulls), [pull, nightPulls]);
  const spells = useMemo(() => spellIndex(pull), [pull]);

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
      const system: ChatMessage = { role: 'system', content: `${systemPrompt()}\n\n# ${dossierTitle()}\n${context}` };
      const answer = inTauri ? await aiChat([system, ...next.slice(-HISTORY)]) : await demoAnswer(q);
      update([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="muted pad">{t.loading}</p>;
  const config = status.ai;
  if (!config) {
    return (
      <div className="panel setup-cta">
        <Bot size={20} strokeWidth={1.5} className="muted" aria-hidden />
        <div>
          <h3>{t.setupTitle}</h3>
          <p className="muted small">{t.setupText}</p>
        </div>
        <button className="btn primary" onClick={() => openSettings('ai')}>
          <Settings2 size={14} strokeWidth={1.5} aria-hidden /> {t.setup}
        </button>
      </div>
    );
  }

  const preset = PRESETS.find((x) => x.id === config.provider);
  return (
    <div className="ask">
      <header className="ask-head">
        <span className="small muted">
          <Bot size={14} strokeWidth={1.5} className="inline-icon" aria-hidden /> {preset?.label ?? config.provider} · {config.model || t.defaultModel}
        </span>
        <span className="small muted" title={t.contextSizeTitle}>
          {t.contextSize(Math.round(estimateTokens(context) / 100) / 10)}
        </span>
        <span className="head-actions">
          <button className="btn ghost sm" onClick={() => setShowContext(!showContext)} aria-expanded={showContext}>
            <FileText size={14} strokeWidth={1.5} aria-hidden /> {showContext ? t.hideDossier : t.showDossier}
          </button>
          {messages.length > 0 && (
            <button className="btn ghost sm" onClick={() => update([])}>
              <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> {t.newChat}
            </button>
          )}
          {inTauri && (
            <button className="btn ghost sm" onClick={() => openSettings('ai')}>
              <Settings2 size={14} strokeWidth={1.5} aria-hidden /> {t.switchProvider}
            </button>
          )}
        </span>
      </header>

      {showContext && <pre className="ask-context">{context}</pre>}

      <div className="ask-thread">
        {messages.length === 0 && (
          <div className="ask-empty">
            <p className="muted small">{t.emptyHint}</p>
            <div className="ask-suggestions">
              {suggestedQuestions().map((s) => (
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
        {busy && <div className="ask-msg assistant muted">{t.thinking}</div>}
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
          placeholder={t.placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          <Send size={14} strokeWidth={1.75} aria-hidden /> {t.ask}
        </button>
      </form>
      <p className="muted small">{t.privacy}</p>
    </div>
  );
}

/** Navegador (desenvolvimento da UI): resposta de exemplo, sem chamar provedor. */
async function demoAnswer(q: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 500));
  return messagesOf(askMsg).demo(q);
}

// ---------------------------------------------------------------------------
// Markdown mínimo das respostas (sem HTML: parágrafos, listas, títulos, **negrito**, _itálico_, `código`)

type Spells = Map<string, number> | undefined;

/** Troca nomes de habilidades conhecidas (do pull) por ícone + nome. */
/** Ícones das habilidades e, no que sobra de texto, os nomes dos personagens coloridos. */
function withIcons(text: string, spells: Spells, keyBase: string, names: RegExp | null): ReactNode[] {
  const plain = (s: string, k: string) => withPlayerNames(s, k, names);
  if (!spells?.size) return plain(text, keyBase);
  const spellNames = [...spells.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}])(${spellNames.join('|')})(?![\\p{L}])`, 'giu');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(...plain(text.slice(last, m.index), `${keyBase}-p${last}`));
    out.push(<SpellName key={`${keyBase}-${m.index}`} spellId={spells.get(m[0].normalize('NFC').toLocaleLowerCase('en'))} name={m[0]} size={16} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...plain(text.slice(last), `${keyBase}-p${last}`));
  return out;
}

function inline(text: string, spells: Spells, names: RegExp | null): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(...withIcons(text.slice(last, m.index), spells, `t${last}`, names));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={m.index}>{withIcons(t.slice(2, -2), spells, `b${m.index}`, names)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    else out.push(<em key={m.index}>{withIcons(t.slice(1, -1), spells, `i${m.index}`, names)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(...withIcons(text.slice(last), spells, `t${last}`, names));
  return out;
}

/** `spells`: nome (minúsculas) -> spell, para mostrar o ícone ao lado das habilidades citadas. */
export function Markdown({ text, spells }: { text: string; spells?: Map<string, number> }) {
  const pc = usePlayerClasses();
  const names = useMemo(() => namesRegex(pc), [pc]);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, spells, names)}</li>
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
    blocks.push(h ? <h4 key={blocks.length}>{inline(h[1], spells, names)}</h4> : <p key={blocks.length}>{inline(line, spells, names)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}
