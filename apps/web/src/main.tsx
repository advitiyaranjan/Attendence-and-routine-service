import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initAuth, listenForGoogleReturn } from './lib/auth';
import { runMigrations } from './lib/migrations';
import { startCatchUp } from './lib/catchup';
import { initKeyboard } from './lib/keyboard';
import { initNative } from './lib/native';
import { performNotificationAction, startNotificationScheduler, syncTimezone } from './lib/notifications';
import { isNative } from './lib/platform';
import { startSyncEngine, syncNow } from './lib/sync';
import './index.css';

// In the Android app every asset ships inside the APK, so no service worker is needed.
if (!isNative) registerSW({ immediate: true });
void runMigrations();
initKeyboard();
startSyncEngine();
listenForGoogleReturn();
void initAuth();
startNotificationScheduler();
startCatchUp();
void syncTimezone();
void initNative({
  onAction: (action, payload) => performNotificationAction(action, payload as never),
  onResume: () => void syncNow(),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
