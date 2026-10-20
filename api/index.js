import { createApp } from '../server/src/app.js';
import { createDb } from '../server/src/db.js';

/**
 * Vercel entrypoint.
 *
 * The whole Express app runs inside one Node function; Vercel serves `web/dist`
 * statically and rewrites `/api/*` here. The pool and the app are created once per
 * warm lambda and reused across invocations.
 */
const db = createDb({ max: 3 });

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await db.migrate();
      return createApp(db);
    })().catch((err) => {
      appPromise = null; // allow a later invocation to retry after a cold-start failure
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
