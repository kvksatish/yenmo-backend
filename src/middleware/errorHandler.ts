/**
 * errorHandler.ts — Global Express error-handling middleware.
 *
 * This is the catch-all error handler mounted LAST in the middleware chain
 * (after all routes). Any error that is thrown or passed to `next(err)` in
 * a route handler or earlier middleware ends up here.
 *
 * Express identifies error-handling middleware by its 4-parameter signature
 * (err, req, res, next). Even though `_req` and `_next` are unused, all
 * four parameters must be declared or Express will not recognize this as
 * an error handler.
 *
 * Security consideration: In production, the actual error message is hidden
 * from the client to avoid leaking internal details (stack traces, file paths,
 * database errors). In development, the real message is returned for easier debugging.
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Catches all unhandled errors from upstream middleware and route handlers.
 *
 * @param err   - The error object thrown or passed via next(err).
 * @param _req  - The Express request (unused, but required for the 4-param signature).
 * @param res   - The Express response used to send the error JSON.
 * @param _next - The next middleware (unused — this is the terminal error handler).
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Log the full error with stack trace server-side for debugging.
  // This always runs regardless of NODE_ENV.
  console.error(`[ERROR] ${err.message}`, err.stack);

  // Respond with 500 and a JSON error body.
  // In production: generic message to avoid leaking internals.
  // In development: the actual error message for faster debugging.
  res.status(500).json({
    error: {
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message,
    },
  });
}
