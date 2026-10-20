import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shells for the same web client.
 *
 *   npm run build
 *   npx cap add ios && npx cap add android
 *   npx cap sync && npx cap open ios
 *
 * The app loads the bundled web build from `web/dist`, so it works offline once
 * launched; API calls go to the server configured in `server.url` while
 * developing, and to the production host when you ship.
 */
const config: CapacitorConfig = {
  appId: 'com.ledgerly.app',
  appName: 'Ledgerly',
  webDir: 'web/dist',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'always',
    backgroundColor: '#f5f6f8',
  },
  android: {
    backgroundColor: '#f5f6f8',
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Uncomment while developing against a local API server:
    // url: 'http://10.0.2.2:4100',
    // cleartext: true,
  },
};

export default config;
