/**
 * sse.ts — Server-Sent Events endpoint and broadcast hub for real-time log streaming.
 *
 * This module serves two roles:
 *
 *   1. **HTTP Route** (`GET /api/events`) — An SSE endpoint that browser clients
 *      connect to. The connection stays open indefinitely, and the server pushes
 *      log events down the wire as they happen.
 *
 *   2. **Broadcast Hub** — Exports three functions (`handleInit`, `broadcastLines`,
 *      `broadcastTruncate`) that the file watcher calls to push data into the SSE
 *      pipeline. This decouples file I/O from network I/O.
 *
 * Data flow:
 *   logFile -> fileWatcher -> broadcastLines() -> SSE write to all clients
 *
 * SSE protocol notes:
 *   - Each message has an `event:` field (init, log, truncate) and a `data:` field
 *     containing a JSON payload. The double newline `\n\n` terminates each message.
 *   - The `:heartbeat` line is an SSE comment (lines starting with `:` are ignored
 *     by the EventSource API) used solely to keep the TCP connection alive through
 *     proxies and load balancers that would otherwise time out idle connections.
 *
 * Memory management:
 *   - `recentLines` is capped at 100 entries to prevent unbounded memory growth.
 *     Only the last 10 are sent to newly connecting clients (as an init payload),
 *     but we keep 100 in case we want to expand the init window later.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ParsedLogLine } from '../utils/logParser.js';

const router = Router();

/**
 * Set of all currently connected SSE clients. Each entry is an Express Response
 * object whose connection is still open. We iterate this set to broadcast events.
 * Using a Set gives O(1) add/delete and prevents duplicate entries.
 */
const clients = new Set<Response>();

/**
 * Rolling buffer of the most recent parsed log lines (capped at 100).
 * New SSE clients receive the last 10 entries from this buffer as their
 * "init" payload so they don't see a blank screen on connect.
 */
let recentLines: ParsedLogLine[] = [];

// --- SSE Endpoint ---
router.get('/events', (req: Request, res: Response) => {
  // Set the required SSE headers. These tell the browser to treat the response
  // as an event stream rather than a regular HTTP response.
  res.setHeader('Content-Type', 'text/event-stream');  // Mandatory for SSE.
  res.setHeader('Cache-Control', 'no-cache');           // Prevent proxy caching of the stream.
  res.setHeader('Connection', 'keep-alive');            // Keep the TCP connection open.
  // X-Accel-Buffering: no — tells Nginx (if used as reverse proxy) not to buffer
  // this response. Without this, Nginx would batch SSE messages and clients would
  // see delayed updates.
  res.setHeader('X-Accel-Buffering', 'no');
  // Flush headers immediately so the client's EventSource fires its 'open' event
  // without waiting for the first data chunk.
  res.flushHeaders();

  // Send the initial batch of the most recent 10 lines so the client has
  // something to render immediately. The 'init' event type tells the frontend
  // to replace (not append to) its current display.
  const initPayload = JSON.stringify({ lines: recentLines.slice(-10) });
  res.write(`event: init\ndata: ${initPayload}\n\n`);

  // Register this client so future broadcasts reach it.
  clients.add(res);
  console.log(`[SSE] Client connected (${clients.size} total)`);

  // Send a heartbeat comment every 15 seconds to keep the connection alive.
  // Many proxies (ALB, Nginx, Cloudflare) close idle connections after 60s.
  // The colon prefix makes this an SSE comment — the browser ignores it,
  // but the TCP stack sees activity and keeps the connection open.
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15_000);

  // Clean up when the client disconnects (browser tab closed, network drop, etc.).
  // Without this, we would accumulate dead Response objects and waste memory
  // trying to write to closed sockets.
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[SSE] Client disconnected (${clients.size} total)`);
  });
});

/**
 * Called by the file watcher after the initial synchronous file read completes.
 * Stores the full set of parsed lines as the "recent lines" buffer so that
 * clients connecting later (after the initial read) can receive historical data.
 *
 * This is called exactly once during normal startup (or again if the file is
 * created after the watcher started).
 *
 * @param lines - All parsed lines from the initial file read.
 */
export function handleInit(lines: ParsedLogLine[]): void {
  recentLines = lines;
  console.log(`[SSE] Initialized with ${lines.length} lines`);
}

/**
 * Called by the file watcher each time new lines are appended to the log file.
 * Performs two operations:
 *
 *   1. Appends the new lines to the in-memory `recentLines` buffer and trims
 *      it to the last 100 entries to cap memory usage.
 *   2. Broadcasts each new line individually as an SSE "log" event to every
 *      connected client.
 *
 * Lines are broadcast one at a time (not as a batch array) so the frontend can
 * append them incrementally and animate each new entry individually.
 *
 * @param lines - Newly parsed log lines from the latest file change.
 */
export function broadcastLines(lines: ParsedLogLine[]): void {
  // Append new lines to the rolling buffer.
  for (const line of lines) {
    recentLines.push(line);
  }

  // Cap the buffer at 100 lines to prevent unbounded memory growth.
  // slice(-100) keeps the most recent 100 entries.
  if (recentLines.length > 100) {
    recentLines = recentLines.slice(-100);
  }

  // Broadcast each line to all connected clients as individual SSE "log" events.
  // The payload is serialized once per line (not once per client) to avoid
  // redundant JSON.stringify calls.
  for (const line of lines) {
    const payload = `event: log\ndata: ${JSON.stringify(line)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }
}

/**
 * Called by the file watcher when a log file truncation is detected (log rotation).
 *
 * This replaces the entire `recentLines` buffer with the new post-truncation
 * contents and sends a "truncate" event to all clients. The frontend should
 * clear its display and render only the new lines, since the old data no
 * longer exists in the file.
 *
 * @param newLines - All parsed lines from the file after truncation (re-read from byte 0).
 */
export function broadcastTruncate(newLines: ParsedLogLine[]): void {
  // Replace the buffer entirely — the old lines are gone from disk.
  recentLines = newLines;

  // Send a single "truncate" event containing all new lines. Unlike broadcastLines
  // which sends one event per line, truncate sends the full set at once because
  // the frontend needs to atomically replace its entire display.
  const truncatePayload = `event: truncate\ndata: ${JSON.stringify({ lines: newLines })}\n\n`;
  for (const client of clients) {
    client.write(truncatePayload);
  }
  console.log(`[SSE] Broadcast truncate with ${newLines.length} lines`);
}

export default router;
