import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installUpdateHandling } from './lib/updates';
import { persistOptions } from './lib/persist';
import { queryClient } from './lib/queries';
import './index.css';

installUpdateHandling();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
