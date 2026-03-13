/**
 * fileWatcher.ts — Watches a log file on disk and emits parsed lines as they appear.
 *
 * This module bridges the filesystem and the SSE broadcasting layer. It uses
 * chokidar (a cross-platform fs.watch wrapper) to detect file changes, then
 * performs byte-level reads to extract only the newly appended content.
 *
 * Key design decisions:
 *
 *   1. **Byte-offset tracking** — Instead of re-reading the entire file on every
 *      change event, we track `lastOffset` (the byte position we have already read
 *      up to) and only read the delta. This is critical for large log files where
 *      re-reading would be O(n) on every append.
 *
 *   2. **Truncation detection** — Log rotation tools (logrotate, pm2, etc.) often
 *      truncate the file and start writing from the beginning. We detect this when
 *      the current file size is smaller than our last known offset, then re-read
 *      from byte 0 and fire a separate `onTruncate` callback so the SSE layer
 *      can tell clients to reset their display.
 *
 *   3. **awaitWriteFinish** — chokidar is configured to wait 100ms for writes to
 *      stabilize before firing 'change'. This prevents reading partial lines when
 *      the log producer flushes in multiple write() calls.
 *
 *   4. **usePolling: false** — We rely on native OS file-system events (inotify on
 *      Linux, FSEvents on macOS) rather than polling. This is more efficient but
 *      may not work on all network filesystems.
 */

import fs from 'node:fs';
import chokidar from 'chokidar';
import { parseLogLines, type ParsedLogLine } from './logParser.js';

/**
 * Byte offset into the log file up to which we have already read.
 * Used to perform incremental reads — on each 'change' event we only
 * read bytes from `lastOffset` to the current file size.
 * Reset to 0 on truncation or when the file is first created.
 */
let lastOffset = 0;

/**
 * Running count of total lines parsed so far. This is passed to
 * `parseLogLines` as the `startLineNumber` so that line numbers
 * in ParsedLogLine objects are globally sequential across chunks,
 * not restarting at 1 for each incremental read.
 */
let totalLineCount = 0;

/**
 * Initializes the file watcher and begins monitoring the specified log file.
 *
 * Lifecycle:
 *   1. Immediately attempts to read the full file (synchronous) and calls `onInit`
 *      with all parsed lines. This populates the SSE "recent lines" buffer so that
 *      clients connecting after startup still see historical data.
 *   2. Sets up a chokidar watcher that fires callbacks on three events:
 *      - 'change' — file was modified (new bytes appended or file truncated)
 *      - 'add'    — file was created (handles the case where the file does not
 *                   exist when the server starts, but is created later)
 *      - 'error'  — watcher encountered a filesystem error
 *
 * @param filePath   - Absolute path to the log file to watch.
 * @param onNewLines - Called with newly parsed lines whenever bytes are appended
 *                     to the file. The SSE layer uses this to broadcast in real time.
 * @param onInit     - Called once with the full initial file contents (parsed).
 *                     The SSE layer stores these as the "recent lines" buffer.
 * @param onTruncate - Optional. Called when the file is detected as truncated
 *                     (log rotation). Receives the full re-parsed contents so the
 *                     SSE layer can tell clients to clear and reload.
 */
export function startWatching(
  filePath: string,
  onNewLines: (lines: ParsedLogLine[]) => void,
  onInit: (lines: ParsedLogLine[]) => void,
  onTruncate?: (lines: ParsedLogLine[]) => void,
): void {
  // --- Phase 1: Initial synchronous read of the existing file ---
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Track offset in bytes (not characters) because fs.readSync operates on
    // byte positions. Buffer.byteLength handles multi-byte UTF-8 correctly.
    lastOffset = Buffer.byteLength(content, 'utf-8');
    const parsed = parseLogLines(content, 1);
    // Set totalLineCount to the highest line number we've seen. Because
    // parseLogLines may skip blank lines, the last entry's lineNumber is
    // the most accurate high-water mark.
    totalLineCount = parsed.length > 0 ? parsed[parsed.length - 1].lineNumber : 0;
    onInit(parsed);
    console.log(`[fileWatcher] Initial read: ${parsed.length} lines, offset: ${lastOffset}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File does not exist yet — this is normal during first deployment or
      // if the log producer hasn't started. The 'add' event below will catch
      // the file when it is eventually created.
      console.warn(`[fileWatcher] Log file not found at ${filePath}, waiting for it to be created...`);
    } else {
      console.error('[fileWatcher] Error reading initial file:', err);
    }
  }

  // --- Phase 2: Set up continuous file watching via chokidar ---
  const watcher = chokidar.watch(filePath, {
    persistent: true,        // Keep the Node process alive for this watcher.
    usePolling: false,       // Use native OS events, not CPU-intensive polling.
    awaitWriteFinish: {
      // Wait for the file to stop being written for 100ms before emitting 'change'.
      // This prevents reading a half-flushed line. The 50ms poll interval is how
      // often chokidar checks whether the file size has stabilized.
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  // --- 'change' handler: file was modified (append or truncation) ---
  watcher.on('change', () => {
    try {
      const stat = fs.statSync(filePath);
      const currentSize = stat.size;

      // --- Truncation detection ---
      // If the file shrank, a log rotation or manual truncation happened.
      // Reset our offset to 0 and re-read the entire (now smaller) file.
      if (currentSize < lastOffset) {
        console.log(`[fileWatcher] Truncation detected (${lastOffset} → ${currentSize}), re-reading`);
        lastOffset = 0;
        totalLineCount = 0;

        // Re-read the full file from the start after truncation.
        const content = fs.readFileSync(filePath, 'utf-8');
        lastOffset = Buffer.byteLength(content, 'utf-8');
        const parsed = parseLogLines(content, 1);
        totalLineCount = parsed.length > 0 ? parsed[parsed.length - 1].lineNumber : 0;
        if (onTruncate) {
          onTruncate(parsed);
        }
        return;
      }

      // No new data — file was touched but not grown (e.g., metadata change).
      if (currentSize <= lastOffset) return;

      // --- Incremental read of only the new bytes ---
      // This is the hot path for normal log appends. We open the file, seek to
      // lastOffset, read exactly (currentSize - lastOffset) bytes, then close.
      // Using low-level fs.openSync/readSync/closeSync instead of readFileSync
      // to avoid reading the entire file into memory.
      const bytesToRead = currentSize - lastOffset;
      const buffer = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, bytesToRead, lastOffset);
      fs.closeSync(fd);

      // Convert the raw bytes to a UTF-8 string and parse into log entries.
      // Line numbering continues from where we left off (totalLineCount + 1).
      const chunk = buffer.toString('utf-8');
      const newLines = parseLogLines(chunk, totalLineCount + 1);

      if (newLines.length > 0) {
        // Advance our line counter to the highest line number in this batch.
        totalLineCount = newLines[newLines.length - 1].lineNumber;
        onNewLines(newLines);
        console.log(`[fileWatcher] New lines: ${newLines.length}`);
      }

      // Advance the byte offset so the next 'change' event reads from here.
      lastOffset = currentSize;
    } catch (err) {
      console.error('[fileWatcher] Error reading file changes:', err);
    }
  });

  // --- 'add' handler: file was created after watcher started ---
  // This covers the scenario where the log file does not exist at startup
  // (e.g., the log producer starts after the backend). chokidar fires 'add'
  // when the file first appears on disk.
  watcher.on('add', () => {
    // Guard: only do the initial read if we haven't already read the file.
    // Without this check, the 'add' event on an already-read file would
    // duplicate the initial data.
    if (lastOffset === 0) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        lastOffset = Buffer.byteLength(content, 'utf-8');
        const parsed = parseLogLines(content, 1);
        totalLineCount = parsed.length > 0 ? parsed[parsed.length - 1].lineNumber : 0;
        onInit(parsed);
        console.log(`[fileWatcher] File created, initial read: ${parsed.length} lines`);
      } catch (err) {
        console.error('[fileWatcher] Error reading newly created file:', err);
      }
    }
  });

  // --- 'error' handler: catch and log watcher-level errors ---
  // These are typically permission errors or OS-level watch limit exhaustion.
  watcher.on('error', (err) => {
    console.error('[fileWatcher] Watcher error:', err);
  });

  console.log(`[fileWatcher] Watching ${filePath}`);
}
