import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ParsedLogLine } from '../utils/logParser.js';

const router = Router();

const clients = new Set<Response>();
let recentLines: ParsedLogLine[] = [];

router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial batch of last 10 lines
  const initPayload = JSON.stringify({ lines: recentLines.slice(-10) });
  res.write(`event: init\ndata: ${initPayload}\n\n`);

  clients.add(res);
  console.log(`[SSE] Client connected (${clients.size} total)`);

  // Heartbeat as SSE comment every 15 seconds
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[SSE] Client disconnected (${clients.size} total)`);
  });
});

/**
 * Called by the file watcher when the initial file contents are parsed.
 * Stores them so new SSE clients receive the last 10 lines on connect.
 */
export function handleInit(lines: ParsedLogLine[]): void {
  recentLines = lines;
  console.log(`[SSE] Initialized with ${lines.length} lines`);
}

/**
 * Called by the file watcher when new lines are appended to the log file.
 * Broadcasts each new line to all connected SSE clients.
 */
export function broadcastLines(lines: ParsedLogLine[]): void {
  for (const line of lines) {
    recentLines.push(line);
  }

  // Keep only the last 100 lines in memory
  if (recentLines.length > 100) {
    recentLines = recentLines.slice(-100);
  }

  for (const line of lines) {
    const payload = `event: log\ndata: ${JSON.stringify(line)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }
}

export default router;
