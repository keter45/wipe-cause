import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary, ErrorToasts } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errors';
import './styles.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="no app" full>
      <App />
    </ErrorBoundary>
    <ErrorToasts />
  </StrictMode>,
);
