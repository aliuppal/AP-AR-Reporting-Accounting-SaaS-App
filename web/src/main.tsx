import { createRoot } from 'react-dom/client';
import { App } from './app';

const root = document.getElementById('root');
const boot = document.getElementById('boot');

if (root) {
  createRoot(root).render(<App />);
  boot?.remove();
}

// PWA: cache the shell so the app opens instantly and works offline for read-only views.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
