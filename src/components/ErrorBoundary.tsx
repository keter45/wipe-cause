import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCopy, RotateCcw, X } from 'lucide-react';
import { dismissError, errorMessage, onErrors, type AppError } from '../lib/errors';
import { messagesOf, useMessages } from '../i18n';
import { errorMsg } from './ErrorBoundary.i18n';

interface Props {
  children: ReactNode;
  /** onde quebrou, para a mensagem ("na aba Mortes", "no app") */
  label: string;
  /** mudou (outro pull, outra aba): tenta de novo sozinho */
  resetKey?: unknown;
  /** tela inteira, com "Recarregar o app" (o último nível de proteção) */
  full?: boolean;
}

interface State {
  error: unknown;
  stack: string;
}

/**
 * Um erro dentro de `children` mostra uma mensagem no lugar dele, e o resto do app continua
 * funcionando. Por aba e, por último, em volta do app inteiro.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ stack: `${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}\n${info.componentStack ?? ''}` });
    console.error(`[${this.props.label}]`, error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error != null && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: '' });
  }

  render() {
    if (this.state.error == null) return this.props.children;
    const retry = () => this.setState({ error: null, stack: '' });
    const t = messagesOf(errorMsg);
    return (
      <div className={`error-box ${this.props.full ? 'full' : ''}`} role="alert">
        <h3>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden /> {t.title(this.props.label)}
        </h3>
        <p className="small">{errorMessage(this.state.error)}</p>
        <p className="muted small">{t.rest}</p>
        <div className="error-actions">
          <button className="btn sm" onClick={retry}>
            <RotateCcw size={14} strokeWidth={1.5} aria-hidden /> {t.retry}
          </button>
          {this.props.full && (
            <button className="btn sm" onClick={() => window.location.reload()}>
              {t.reload}
            </button>
          )}
          <CopyDetails text={this.state.stack || errorMessage(this.state.error)} />
        </div>
      </div>
    );
  }
}

/**
 * Componente com a própria proteção: um erro dentro dele não derruba a tela em volta. `label`:
 * onde quebrou, no idioma atual ("no resumo da noite").
 */
export function withErrorBoundary<P extends object>(Inner: ComponentType<P>, label: () => string) {
  const Wrapped = (props: P) => (
    <ErrorBoundary label={label()}>
      <Inner {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `Protected(${Inner.displayName ?? Inner.name})`;
  return Wrapped;
}

function CopyDetails({ text }: { text: string }) {
  const t = useMessages(errorMsg);
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm"
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => setDone(true))
          .catch(() => {})
      }
    >
      <ClipboardCopy size={14} strokeWidth={1.5} aria-hidden /> {done ? t.copied : t.copy}
    </button>
  );
}

/** Erros fora da tela (promessas sem tratamento, chamadas ao backend) como aviso no canto. */
export function ErrorToasts() {
  const t = useMessages(errorMsg);
  const [errors, setErrors] = useState<AppError[]>([]);
  useEffect(() => onErrors(setErrors), []);
  if (errors.length === 0) return null;
  return (
    <div className="error-toasts" role="status" aria-live="polite">
      {errors.map((e) => (
        <div key={e.id} className="error-toast">
          <AlertTriangle size={16} strokeWidth={1.75} className="bad" aria-hidden />
          <div className="error-toast-body">
            <strong>{e.where}</strong>
            <span className="small">{e.message}</span>
          </div>
          <CopyDetails text={e.detail} />
          <button className="icon-btn sm" onClick={() => dismissError(e.id)} aria-label={t.close}>
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
