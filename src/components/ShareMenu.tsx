import { useState, type ReactElement } from 'react';
import { Check, ClipboardCopy, FileCode, FileText, ImageDown, MessageSquare, Share2 } from 'lucide-react';
import { inTauri } from '../lib/api';
import { cardHtml, cardPng, copyPng, fileSlug, printPdf, saveHtml, savePng, sendPngToDiscord } from '../lib/share';
import { Popover } from './Popover';

type Action = 'copy' | 'png' | 'html' | 'pdf' | 'discord';

const LABEL: Record<Action, string> = {
  copy: 'Copiar imagem',
  png: 'Salvar imagem (PNG)',
  html: 'Salvar página (HTML)',
  pdf: 'Salvar PDF (com links)',
  discord: 'Enviar imagem ao Discord',
};
const DONE: Record<Action, string> = {
  copy: 'Imagem copiada: cole no Discord ou WhatsApp',
  png: 'Imagem salva',
  html: 'Página salva',
  pdf: 'Na janela que abriu, escolha “Salvar como PDF”',
  discord: 'Imagem enviada ao Discord',
};

/**
 * "Compartilhar": gera o cartão (`card()`) como imagem ou página, para quem não tem o app.
 * `name`: base do nome do arquivo e título. `pdf`: oferece PDF (links clicáveis).
 */
export function ShareMenu({ card, name, pdf = false }: { card: () => ReactElement; name: string; pdf?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = fileSlug(name) || 'wipe-cause';

  async function run(a: Action) {
    setBusy(a);
    setMsg(null);
    try {
      if (a === 'html') {
        if (!(await saveHtml(await cardHtml(card(), name), `${file}.html`))) return;
      } else if (a === 'pdf') {
        await printPdf(await cardHtml(card(), name));
      } else {
        const png = await cardPng(card());
        if (a === 'copy') await copyPng(png);
        else if (a === 'png' && !(await savePng(png, `${file}.png`))) return;
        else if (a === 'discord') await sendPngToDiscord(png, `${file}.png`, name);
      }
      setMsg({ ok: true, text: DONE[a] });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  const actions: Action[] = [
    'copy',
    'png',
    ...(pdf ? (['pdf'] as const) : []),
    'html',
    ...(inTauri ? (['discord'] as const) : []),
  ];
  const icons = { copy: ClipboardCopy, png: ImageDown, html: FileCode, pdf: FileText, discord: MessageSquare };

  return (
    <Popover
      open={open}
      onClose={() => {
        setOpen(false);
        setMsg(null);
      }}
      label="Compartilhar"
      trigger={
        <button className={`btn sm ${open ? 'pressed' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Share2 size={14} strokeWidth={1.5} aria-hidden /> Compartilhar
        </button>
      }
    >
      <h4>Compartilhar</h4>
      <p className="muted small">Um cartão com o resumo, para quem não tem o app.</p>
      <div className="share-actions">
        {actions.map((a) => {
          const Icon = icons[a];
          return (
            <button key={a} className="btn ghost sm" onClick={() => run(a)} disabled={busy != null}>
              <Icon size={14} strokeWidth={1.5} aria-hidden /> {busy === a ? 'Gerando…' : LABEL[a]}
            </button>
          );
        })}
      </div>
      {msg && (
        <p className={`small ${msg.ok ? 'ok-text' : 'bad'}`}>
          {msg.ok && <Check size={12} strokeWidth={2} aria-hidden />} {msg.text}
        </p>
      )}
    </Popover>
  );
}
