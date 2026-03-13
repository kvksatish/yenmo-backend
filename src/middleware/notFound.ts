/**
 * notFound.ts — 404 catch-all middleware for unmatched routes.
 *
 * Mounted after all route handlers but BEFORE the error handler in the
 * middleware chain. If a request makes it here, no route matched it.
 *
 * Returns a consistent JSON error response (not HTML) because this is a
 * pure API server — there are no HTML pages to serve. The JSON format
 * matches the structure used by errorHandler.ts for consistency:
 *   { error: { message: "..." } }
 *
 * Note: This is a regular middleware (2 params), not an error handler (4 params).
 * It does not call next() because it is terminal — the response ends here.
 */

import type { Request, Response } from 'express';

/**
 * Responds with a 404 JSON error for any request that did not match a defined route.
 *
 * @param _req - The unmatched Express request (unused).
 * @param res  - The Express response used to send the 404 JSON.
 */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { message: 'Route not found' } });
}
