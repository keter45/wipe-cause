import type { ReactNode } from 'react';
import { Check, CircleDashed, CloudDownload, Radio } from 'lucide-react';
import { missingRequired, useSetup, type SettingsSection } from '../../lib/setup';

/**
 * Passo a passo do app: aberto na primeira vez (a tela inicial é esta) e, depois, recolhido em
 * "Como funciona". Cada passo mostra se já está pronto e leva ao cartão dele.
 */
export function FirstSteps({ firstRun, onStart, onOpen }: { firstRun: boolean; onStart: () => void; onOpen: (s: SettingsSection) => void }) {
  const { status } = useSetup();
  const logsOk = status != null && !missingRequired(status);
  const wclUser = status?.wcl?.user ?? null;

  const body = (
    <>
      <ol className="steps">
        <Step done={logsOk} title="Pasta de logs do WoW" action={<button className="link" onClick={() => onOpen('logs')}>{logsOk ? 'Ver' : 'Configurar'}</button>}>
          O app lê o combat log que o WoW grava no seu PC ({status?.logsDir ? <code>{status.logsDir}</code> : <code>World of Warcraft\_retail_\Logs</code>}). Normalmente é
          encontrada sozinha.
        </Step>
        <Step done={null} title="No jogo: ligar o combat log" action={<button className="link" onClick={() => onOpen('game')}>Como</button>}>
          Em <em>Opções → Rede</em>, ligue o <em>Advanced Combat Logging</em>. Antes do primeiro pull da noite, digite <code>/combatlog</code> (ou use o uploader do
          Warcraft Logs, que liga sozinho).
        </Step>
        <Step
          done={wclUser != null}
          title="Entrar com o Warcraft Logs (recomendado)"
          action={<button className="link" onClick={() => onOpen('wcl')}>{wclUser ? 'Ver' : 'Entrar'}</button>}
        >
          {wclUser ? <>Conectado como <strong>{wclUser.name}</strong>. </> : null}
          Com a sua conta, o app vê os logs da sua guilda: mostra o que faltou no log do seu PC, liga o ao vivo sozinho quando a raid começa e traz o parse
          de cada um. Não precisa criar chave nem client.
        </Step>
        <Step done={null} title="Opcional" action={<button className="link" onClick={() => onOpen('startup')}>Ver opções</button>}>
          Ligar o ao vivo sozinho quando o WoW abrir, vídeos do Warcraft Recorder, aviso no Discord a cada pull e perguntas à IA.
        </Step>
      </ol>

      <div className="how">
        <h3>No dia a dia</h3>
        <ul>
          <li>
            <strong>Nova análise</strong>: cada noite aparece numa linha, com os bosses. <em>Analisar</em> usa o log do seu PC — rápido e sem baixar nada.
          </li>
          <li>
            <CloudDownload size={14} strokeWidth={1.75} className="wcl-mark" aria-hidden /> marca bosses e pulls que <strong>não estão no seu log</strong> mas estão no
            Warcraft Logs (você saiu antes, entrou depois, estava longe). <em>Completar</em> baixa só o que falta; demora alguns minutos, então é você quem
            decide. Depois do primeiro download, reabrir é rápido.
          </li>
          <li>
            <Radio size={14} strokeWidth={1.75} aria-hidden /> <strong>Ao vivo</strong>: durante a raid, cada pull é analisado assim que termina. Com o WoW
            aberto neste PC, usa o seu log; sem ele, segue o log ao vivo da guilda no Warcraft Logs (alguém precisa estar com o <em>Live Logging</em> do
            uploader ligado).
          </li>
          <li>Masmorras (M+) ficam de fora: o app é para raid.</li>
        </ul>
      </div>
    </>
  );

  if (!firstRun) {
    return (
      <details className="first-steps panel">
        <summary>Como funciona</summary>
        {body}
      </details>
    );
  }
  return (
    <section className="first-steps panel open">
      <h2>Primeiros passos</h2>
      <p className="muted small">Três coisas e você está pronto. Tudo fica salvo só neste PC.</p>
      {body}
      <div className="set-actions">
        <button className="btn primary" onClick={onStart} disabled={!logsOk} title={logsOk ? undefined : 'Falta a pasta de logs do WoW'}>
          Começar: escolher uma noite
        </button>
      </div>
    </section>
  );
}

function Step({ done, title, action, children }: { done: boolean | null; title: string; action: ReactNode; children: ReactNode }) {
  return (
    <li className={`step ${done ? 'done' : ''}`}>
      <span className="step-mark" aria-hidden>
        {done ? <Check size={14} strokeWidth={2.5} /> : <CircleDashed size={14} strokeWidth={1.75} />}
      </span>
      <div>
        <strong>{title}</strong> {action}
        <p className="muted small">{children}</p>
      </div>
    </li>
  );
}
