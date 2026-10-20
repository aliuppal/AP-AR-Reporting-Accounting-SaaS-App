import { createRoot } from 'react-dom/client';
import { App } from './app';

const root = document.getElementById('root');
const boot = document.getElementById('boot');

if (root) {
  createRoot(root).render(<App />);
  boot?.remove();
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const isLoopback = LOOPBACK.has(window.location.hostname);

if ('serviceWorker' in navigator) {
  if (isLoopback) {
    // Never let a service worker cache a localhost build again: it previously kept
    // serving a pre-redesign shell after the dev server stopped, and every request
    // then failed with a generic sign-in error. Clean up any registration that exists.
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then((removed) => {
        if (removed.some(Boolean)) console.info('[ledgerly] service worker disabled on localhost; cached shell removed');
      })
      .catch(() => {});
  } else if (window.isSecureContext) {
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
}
