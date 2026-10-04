import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary, ErrorToasts } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errors';
import { useMessages } from './i18n';
import { errorMsg } from './components/ErrorBoundary.i18n';
import './styles.css';

installGlobalErrorHandlers();

/** Última proteção: um erro em qualquer lugar mostra a mensagem (no idioma atual) e "Recarregar". */
function Root() {
  const t = useMessages(errorMsg);
  return (
    <ErrorBoundary label={t.inApp} full>
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
    <ErrorToasts />
  </StrictMode>,
);
