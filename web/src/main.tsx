import { createRoot } from 'react-dom/client';
import { App } from './app';

const root = document.getElementById('root');
const boot = document.getElementById('boot');

if (root) {
  createRoot(root).render(<App />);
  boot?.remove();
}

// PWA: cache the shell so the app opens instantly and works offline, and make sure a
// deploy is picked up on the next visit instead of leaving the tab on a stale bundle.
if ('serviceWorker' in navigator && window.isSecureContext) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => {}))
      .catch(() => {
        /* offline support is optional */
      });
  });
}
