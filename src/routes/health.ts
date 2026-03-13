/**
 * health.ts — Lightweight health check endpoint for infrastructure monitoring.
 *
 * Exposes GET /api/health which returns a JSON object indicating the server
 * is alive. This is consumed by:
 *   - Container orchestrators (Docker healthcheck, Kubernetes liveness probe)
 *   - Load balancers to determine if the instance should receive traffic
 *   - Uptime monitoring tools (Pingdom, UptimeRobot, etc.)
 *
 * The response includes `uptime` (seconds since the Node process started)
 * which helps operators quickly see if the server recently restarted.
 *
 * This endpoint intentionally does NOT check downstream dependencies (database,
 * file system, etc.) because it is meant as a simple liveness probe, not a
 * readiness probe. A separate readiness endpoint could be added if needed.
 */

import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),  // ISO 8601 for easy parsing by monitoring tools.
    uptime: process.uptime(),             // Seconds since process start, useful for detecting restarts.
  });
});

export default router;
