/**
 * server.ts — HTTP server entry point.
 *
 * This is the top-level module that starts the Express HTTP server. It is
 * intentionally minimal — all application setup (middleware, routes, file
 * watcher) is handled in app.ts. The separation exists so that:
 *
 *   1. Tests can import `app` and make supertest requests without binding
 *      to a real port (avoiding port conflicts in CI).
 *   2. The listening port and startup log are isolated to one place.
 *
 * In production, this file is the process entry point:
 *   node dist/server.js
 */

import app from './app.js';
import { config } from './config/env.js';

// Start listening for HTTP connections on the configured port.
// The callback fires once the port is successfully bound.
app.listen(config.port, () => {
  console.log(`[server] Running on http://localhost:${config.port} (${config.nodeEnv})`);
});
