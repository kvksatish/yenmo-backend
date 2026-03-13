/**
 * env.ts — Centralized environment configuration with sensible defaults.
 *
 * Loads environment variables from a .env file (via dotenv) and exports a
 * single `config` object that the rest of the application imports. This
 * provides three benefits:
 *
 *   1. **Single source of truth** — All env vars are declared and defaulted
 *      in one place. No scattered `process.env.XYZ` calls throughout the codebase.
 *   2. **Type safety** — The `as const` assertion makes all values readonly and
 *      their types are narrowed (e.g., port is `number`, not `string | undefined`).
 *   3. **Fail-fast defaults** — Defaults are chosen for local development. In
 *      production, these should be overridden via actual environment variables.
 *
 * Configuration values:
 *   - port:        HTTP server port (default: 3001)
 *   - nodeEnv:     "development" | "production" | "test" (affects error verbosity)
 *   - corsOrigin:  Allowed CORS origin for the frontend (default: Vite dev server)
 *   - logFilePath: Absolute path to the log file being watched (default: sample.log in cwd)
 */

import dotenv from 'dotenv';
import path from 'node:path';

// Load .env file from the project root into process.env.
// This is a no-op if no .env file exists (e.g., in Docker where env vars
// are injected directly), so it is safe to call unconditionally.
dotenv.config();

export const config = {
  // Parse port as an integer. The `|| '3001'` fallback handles the case
  // where PORT is not set. parseInt radix 10 is explicit to avoid octal
  // interpretation of strings like "010".
  port: parseInt(process.env.PORT || '3001', 10),

  // Runtime environment flag. Controls error message verbosity in the
  // error handler middleware and could gate other behaviors (e.g., logging level).
  nodeEnv: process.env.NODE_ENV || 'development',

  // CORS origin whitelist. Only this origin is allowed to make cross-origin
  // requests. Default is the Vite dev server URL for local development.
  // In production, set this to the actual frontend domain.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // Absolute path to the log file that the file watcher monitors.
  // path.resolve ensures the result is always an absolute path, even if
  // LOG_FILE_PATH is relative. Falls back to "sample.log" in the current
  // working directory for local development without any env setup.
  logFilePath: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), 'sample.log'),
} as const;
