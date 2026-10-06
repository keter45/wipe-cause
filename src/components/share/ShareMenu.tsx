import { useState, type ReactElement } from 'react';
import { Check, ClipboardCopy, FileCode, FileText, ImageDown, MessageSquare, Share2 } from 'lucide-react';
import { discordPost, inTauri } from '../../lib/api';
import { cardHtml, cardPng, copyPng, fileSlug, printPdf, saveHtml, savePng, sendPngToDiscord } from '../../lib/share';
import { Popover } from '../Popover';
import type { CardDetail } from './common';
import { PlayerClassesContext, usePlayerClasses } from '../../lib/players';
import { useSetup } from '../../lib/setup';
import { useMessages } from '../../i18n';
import { shareMsg } from './share.i18n';

type Action = 'copy' | 'png' | 'html' | 'pdf' | 'discord' | 'discordText';

/**
 * "Compartilhar": gera o cartão (`card(detail)`) como imagem ou página, para quem não tem o app,
 * em duas versões: o resumo (padrão) ou o completo (tudo aberto).
 * `name`: base do nome do arquivo e título. `pdf`: oferece PDF (links clicáveis).
 * `discord`: a mensagem de texto (resumo) para o canal da raid; sem webhook, o menu leva às
 * Configurações.
 */
export function ShareMenu({ card: makeCard, name, pdf = false, discord }: { card: (detail: CardDetail) => ReactElement; name: string; pdf?: boolean; discord?: () => unknown }) {
  const t = useMessages(shareMsg);
  const [detail, setDetail] = useState<CardDetail>('summary');
  const classes = usePlayerClasses();
  const card = () => <PlayerClassesContext.Provider value={classes}>{makeCard(detail)}</PlayerClassesContext.Provider>;
  const [open, setOpen] = useState(false);
  const { status, openSettings } = useSetup();
  const hasDiscord = !!status?.discord?.webhook;
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = (fileSlug(name) || 'wipe-cause') + (detail === 'full' ? t.fullSuffix : '');
  const title = detail === 'full' ? t.fullTitle(name) : name;

  async function run(a: Action) {
    setBusy(a);
    setMsg(null);
    try {
      if (a === 'discordText') {
        if (discord) await discordPost(discord());
      } else if (a === 'html') {
        if (!(await saveHtml(await cardHtml(card(), title), `${file}.html`))) return;
      } else if (a === 'pdf') {
        await printPdf(await cardHtml(card(), title));
      } else {
        const png = await cardPng(card());
        if (a === 'copy') await copyPng(png);
        else if (a === 'png' && !(await savePng(png, `${file}.png`))) return;
        else if (a === 'discord') await sendPngToDiscord(png, `${file}.png`, title);
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
    ...(inTauri && hasDiscord ? ([...(discord ? (['discordText'] as const) : []), 'discord'] as const) : []),
  ];
  const icons = { copy: ClipboardCopy, png: ImageDown, html: FileCode, pdf: FileText, discord: MessageSquare, discordText: MessageSquare };

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
      <h4>{t.share}</h4>
      <p className="muted small">{t.menuHint}</p>
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
      {inTauri && status && !hasDiscord && (
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
