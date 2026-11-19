import { useState } from 'react';
import { Check, Clapperboard, ClipboardCopy, FileCode, FileText, ImageDown, MessageSquare, Share2 } from 'lucide-react';
import { canEdit, discordPost, hasBackend } from '../../lib/api';
import { cardHtml, cardPng, copyPng, printPdf, saveClip, saveHtml, savePng } from '../../lib/share';
import { postClip, postFile, sendPosts, withClasses, type SharePost } from '../../lib/sharePosts';
import { Popover } from '../Popover';
import type { CardDetail } from './common';
import { usePlayerClasses } from '../../lib/players';
import { useSetup } from '../../lib/setup';
import { useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';
import { Hint } from '../ui/Hint';

type Action = 'copy' | 'png' | 'html' | 'pdf' | 'clip' | 'discord' | 'discordText';

/**
 * "Compartilhar": os posts de `posts(detail)` (lib/sharePosts, os mesmos do Discord automático)
 * como imagem ou página, para quem não tem o app, em duas versões: o resumo (padrão) ou o
 * completo (tudo aberto). Imagem = o cartão principal; HTML/PDF = todos os cartões, um embaixo do
 * outro; Discord = uma mensagem por cartão, o wipe com o clipe dos erros.
 * `pdf`: oferece PDF (links clicáveis) também no resumo. `discord`: a mensagem de texto (resumo)
 * para o canal da raid; sem webhook, o menu leva às Configurações.
 */
export function ShareMenu({ posts: makePosts, pdf = false, discord }: { posts: (detail: CardDetail) => SharePost[]; pdf?: boolean; discord?: () => unknown }) {
  const t = useMessages(shareMsg);
  const [detail, setDetail] = useState<CardDetail>('summary');
  const classes = usePlayerClasses();
  const [open, setOpen] = useState(false);
  const { status, openSettings } = useSetup();
  const hasDiscord = !!status?.discord?.webhook;
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // o completo leva "(completo)" no título e no nome do arquivo
  const posts = () => makePosts(detail).map((p) => (detail === 'full' ? { ...p, title: t.fullTitle(p.title) } : p));
  const hasClip = open && !!makePosts('summary')[0]?.clip;

  async function run(a: Action) {
    setBusy(a);
    setMsg(null);
    try {
      const all = posts();
      const main = all[0];
      if (!main) return;
      if (a === 'discordText') {
        if (discord) await discordPost(discord());
      } else if (a === 'discord') {
        await sendPosts(all, classes);
      } else if (a === 'html' || a === 'pdf') {
        const page = withClasses(<div className="share-stack">{all.map((p, i) => <div key={i}>{p.card}</div>)}</div>, classes);
        const html = await cardHtml(page, main.title);
        if (a === 'pdf') await printPdf(html);
        else if (!(await saveHtml(html, `${postFile(main)}.html`))) return;
      } else if (a === 'clip') {
        const c = await postClip(main);
        if (!c || !(await saveClip(c.bytes, c.name))) return;
      } else {
        const png = await cardPng(withClasses(main.card, classes));
        if (a === 'copy') await copyPng(png);
        else if (!(await savePng(png, `${postFile(main)}.png`))) return;
      }
      setMsg({ ok: true, text: t.done[a] });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  const actions: Action[] = [
    'copy',
    'png',
    // PDF: links clicáveis e páginas; serve para o completo (e para quem pediu sempre)
    ...(pdf || detail === 'full' ? (['pdf'] as const) : []),
    'html',
    ...(hasClip ? (['clip'] as const) : []),
    ...(hasBackend && hasDiscord ? ([...(discord ? (['discordText'] as const) : []), 'discord'] as const) : []),
  ];
  const icons = { copy: ClipboardCopy, png: ImageDown, html: FileCode, pdf: FileText, clip: Clapperboard, discord: MessageSquare, discordText: MessageSquare };

  return (
    <Popover
      open={open}
      onClose={() => {
        setOpen(false);
        setMsg(null);
      }}
      label={t.share}
      trigger={
        <button className={`btn sm ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Share2 size={14} strokeWidth={1.5} aria-hidden /> {t.share}
        </button>
      }
    >
      <h4>{t.share} <Hint>{t.menuHint}</Hint></h4>
      <div className="segmented sm share-detail" role="radiogroup" aria-label={t.versionAria}>
        {(
          [
            ['summary', t.summary, t.summaryHint],
            ['full', t.full, t.fullHint],
          ] as const
        ).map(([k, label, hint]) => (
          <button key={k} role="radio" aria-checked={detail === k} className={detail === k ? 'active' : ''} title={hint} onClick={() => setDetail(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="share-actions">
        {actions.map((a) => {
          const Icon = icons[a];
          return (
            <button key={a} className="btn ghost sm" onClick={() => run(a)} disabled={busy != null}>
              <Icon size={14} strokeWidth={1.5} aria-hidden /> {busy === a ? t.generating : t.label[a]}
            </button>
          );
        })}
      </div>
      {canEdit && status && !hasDiscord && (
        <p className="muted small">
          {t.discordSetup((text) => (
            <button
              className="link"
              onClick={() => {
                setOpen(false);
                openSettings('discord');
              }}
            >
              {text}
            </button>
          ))}
        </p>
      )}
      {msg && (
        <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>
          {msg.ok && <Check size={12} strokeWidth={2} aria-hidden />} {msg.text}
        </p>
      )}
    </Popover>
  );
}
