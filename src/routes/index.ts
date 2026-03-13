/**
 * routes/index.ts — Central route aggregator.
 *
 * Combines all route modules into a single router that is mounted at the
 * `/api` prefix in app.ts. Adding a new route module is a two-step process:
 *   1. Create the route file (e.g., routes/logs.ts)
 *   2. Import and `router.use()` it here
 *
 * This pattern keeps app.ts clean — it only mounts one router — and makes it
 * easy to see every route group the API exposes in a single file.
 *
 * Current routes:
 *   - GET /api/health  — Liveness probe (from health.ts)
 *   - GET /api/events  — SSE log stream (from sse.ts)
 */

import { Router } from 'express';
import healthRouter from './health.js';
import sseRouter from './sse.js';

const router = Router();

// Mount sub-routers. Order does not matter here because each sub-router
// uses distinct path prefixes (/health vs /events), so there is no
// ambiguity or shadowing between them.
router.use(healthRouter);
router.use(sseRouter);

export default router;
