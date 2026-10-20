import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { StoreProvider } from './lib/store';
import { DemoStoreProvider, demoOn } from './lib/demo';
import { App } from './App';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      {demoOn() ? <DemoStoreProvider><App /></DemoStoreProvider> : <StoreProvider><App /></StoreProvider>}
    </BrowserRouter>
  </StrictMode>,
);
