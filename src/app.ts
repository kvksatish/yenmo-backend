/**
 * app.ts — Express application factory and middleware composition.
 *
 * This module creates the Express app, wires up the middleware chain in the
 * correct order, and starts the file watcher. It does NOT start the HTTP
 * server — that responsibility belongs to server.ts. This separation allows
 * the app to be imported and tested without binding to a port.
 *
 * Middleware execution order (top to bottom):
 *   1. helmet()        — Sets security-related HTTP headers (X-Frame-Options,
 *                         Content-Security-Policy, etc.)
 *   2. cors()          — Adds CORS headers so the frontend can make cross-origin
 *                         requests to this API.
 *   3. express.json()  — Parses JSON request bodies (Content-Type: application/json).
 *   4. express.urlencoded() — Parses URL-encoded form bodies.
 *   5. /api routes     — All application routes (health, SSE).
 *   6. notFound        — 404 handler for any request that did not match a route.
 *   7. errorHandler    — Global catch-all error handler (must be last).
 *
 * The file watcher is started at module load time (not lazily) because log
 * streaming is the primary purpose of this server — there is no scenario
 * where the watcher should not be running.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { startWatching } from './utils/fileWatcher.js';
import { handleInit, broadcastLines, broadcastTruncate } from './routes/sse.js';

const app = express();

// --- Security & Parsing Middleware ---
// helmet() adds a suite of HTTP headers that mitigate common web vulnerabilities
// (clickjacking, MIME sniffing, XSS, etc.). Must be early in the chain so all
// responses include these headers.
app.use(helmet());

// CORS is restricted to the configured frontend origin. Requests from other
// origins will be rejected by the browser. This is important because the SSE
// endpoint is a long-lived connection that could be abused if open to all origins.
app.use(cors({ origin: config.corsOrigin }));

// Body parsers for JSON and form-encoded payloads. Currently no routes use
// POST/PUT, but these are included for forward compatibility so new endpoints
// do not need to add their own parsing middleware.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- API Routes ---
// All routes are grouped under /api to keep a clean namespace and make it easy
// to add a reverse proxy rule that forwards /api/* to this backend.
app.use('/api', routes);

// --- Error Handling ---
// notFound must come after routes but before errorHandler.
// errorHandler must be the very last middleware (Express requires the 4-param signature
// to be registered last to function as an error handler).
app.use(notFound);
app.use(errorHandler);

// --- File Watcher Initialization ---
// Wire the file watcher's callbacks directly to the SSE broadcast functions.
// This is the glue that connects the file I/O layer to the network I/O layer:
//   - handleInit        -> called once with the full initial file contents
//   - broadcastLines    -> called on every file append with only the new lines
//   - broadcastTruncate -> called when the file is truncated (log rotation)
startWatching(config.logFilePath, broadcastLines, handleInit, broadcastTruncate);

export default app;
