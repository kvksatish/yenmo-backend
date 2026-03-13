import fs from 'node:fs';
import chokidar from 'chokidar';
import { parseLogLines, type ParsedLogLine } from './logParser.js';

let lastOffset = 0;
let totalLineCount = 0;

export function startWatching(
  filePath: string,
  onNewLines: (lines: ParsedLogLine[]) => void,
  onInit: (lines: ParsedLogLine[]) => void,
  onTruncate?: (lines: ParsedLogLine[]) => void,
): void {
  // Read entire file on startup
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    lastOffset = Buffer.byteLength(content, 'utf-8');
    const parsed = parseLogLines(content, 1);
    totalLineCount = parsed.length > 0 ? parsed[parsed.length - 1].lineNumber : 0;
    onInit(parsed);
    console.log(`[fileWatcher] Initial read: ${parsed.length} lines, offset: ${lastOffset}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[fileWatcher] Log file not found at ${filePath}, waiting for it to be created...`);
    } else {
      console.error('[fileWatcher] Error reading initial file:', err);
    }
  }

  // Watch for changes
  const watcher = chokidar.watch(filePath, {
    persistent: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', () => {
    try {
      const stat = fs.statSync(filePath);
      const currentSize = stat.size;

      if (currentSize < lastOffset) {
        // File was truncated — re-read from the beginning
        console.log(`[fileWatcher] Truncation detected (${lastOffset} → ${currentSize}), re-reading`);
        lastOffset = 0;
        totalLineCount = 0;

        // Re-read entire file and broadcast as truncate event
        const content = fs.readFileSync(filePath, 'utf-8');
        lastOffset = Buffer.byteLength(content, 'utf-8');
        const parsed = parseLogLines(content, 1);
        totalLineCount = parsed.length > 0 ? parsed[parsed.length - 1].lineNumber : 0;
        if (onTruncate) {
          onTruncate(parsed);
        }
        return;
      }

      if (currentSize <= lastOffset) return;

      const bytesToRead = currentSize - lastOffset;
      const buffer = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, bytesToRead, lastOffset);
      fs.closeSync(fd);

      const chunk = buffer.toString('utf-8');
      const newLines = parseLogLines(chunk, totalLineCount + 1);

      if (newLines.length > 0) {
        totalLineCount = newLines[newLines.length - 1].lineNumber;
        onNewLines(newLines);
        console.log(`[fileWatcher] New lines: ${newLines.length}`);
      }

      lastOffset = currentSize;
    } catch (err) {
      console.error('[fileWatcher] Error reading file changes:', err);
    }
  });

  watcher.on('add', () => {
    // File was created after watcher started — do initial read
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

  watcher.on('error', (err) => {
    console.error('[fileWatcher] Watcher error:', err);
  });

  console.log(`[fileWatcher] Watching ${filePath}`);
}
