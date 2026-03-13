import { Router } from 'express';
import healthRouter from './health.js';
import sseRouter from './sse.js';

const router = Router();

router.use(healthRouter);
router.use(sseRouter);

export default router;
