import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initAuth } from './lib/auth';
import { startNotificationScheduler, syncTimezone } from './lib/notifications';
import { startSyncEngine } from './lib/sync';
import './index.css';

registerSW({ immediate: true });
startSyncEngine();
void initAuth();
startNotificationScheduler();
void syncTimezone();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
