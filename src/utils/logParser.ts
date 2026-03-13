/**
 * logParser.ts — Transforms raw log file text into structured, typed objects.
 *
 * This module is the core data-transformation layer of the pipeline. Every line
 * that the file watcher reads ultimately passes through `parseLogLine` before
 * being sent to SSE clients. Two outcomes are possible for each line:
 *
 *   1. **Structured** — the line matches the expected log format and is
 *      decomposed into timestamp, level, module, function, and message fields.
 *   2. **Unstructured** — the line does not match. It is kept as-is in the
 *      `raw` field so the frontend can still display it (stack traces,
 *      multi-line output, free-form messages, etc.).
 *
 * Design decisions:
 *   - A monotonically increasing `idCounter` is used instead of UUIDs because
 *     the IDs only need to be unique within a single server lifetime (they
 *     reset on restart). This avoids the cost of UUID generation on every line.
 *   - The regex is intentionally strict — only lines that fully match the
 *     known format are marked `isStructured: true`. This prevents partial
 *     matches from producing garbage field values.
 */

/** Shape of a single parsed log entry sent to SSE clients. */
export interface ParsedLogLine {
  /** Monotonically increasing string ID, unique per server lifetime. */
  id: string;
  /** Extracted timestamp in "MM/DD HH:MM:SS" format, if structured. */
  timestamp?: string;
  /** Log severity level (INFO, WARN, ERROR, DEBUG, TRACE, FATAL), if structured. */
  level?: string;
  /** The module/component name that produced the log, if structured. */
  module?: string;
  /** The function name within the module, if structured. */
  function?: string;
  /** The free-text message portion of the log line, if structured. */
  message?: string;
  /** The original, unmodified line text (always present for both structured and unstructured). */
  raw: string;
  /** True when the line matched the known log format and fields were extracted. */
  isStructured: boolean;
  /** 1-based line number relative to the file (or relative to the chunk for incremental reads). */
  lineNumber: number;
}

/**
 * In-memory counter that produces unique IDs for each parsed line.
 * Starts at 0 and increments before every return, so the first line gets id "1".
 * This is module-level state — it persists across calls but resets when the
 * server process restarts.
 */
let idCounter = 0;

/**
 * Regular expression that captures the five fields of a structured log line.
 *
 * Expected format example:
 *   03/22 08:52:50 INFO   :.......init_policyAPI: open_socket:  Entering
 *
 * Capture groups:
 *   [1] Timestamp  — "03/22 08:52:50"           (MM/DD HH:MM:SS)
 *   [2] Level      — "INFO"                      (one of INFO|WARN|ERROR|DEBUG|TRACE|FATAL)
 *   [3] Module     — "init_policyAPI"            (word chars after the leading dots)
 *   [4] Function   — "open_socket"               (word chars after the colon separator)
 *   [5] Message    — "Entering"                  (everything remaining, may be empty)
 *
 * Breakdown of the pattern:
 *   ^                              — anchor to start of line
 *   (\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})  — timestamp group
 *   \s+                            — whitespace between timestamp and level
 *   (INFO|WARN|ERROR|DEBUG|TRACE|FATAL)  — log level (explicit enum, no wildcard)
 *   \s+                            — whitespace after level
 *   :\.*([\w]+)                    — colon, optional dot padding, then module name
 *   :\s*([\w]+)                    — colon separator, then function name
 *   :\s*(.*)$                      — colon separator, then the rest is the message
 *
 * Tradeoff: This regex only handles one specific log format. If the upstream
 * log producer changes its format, this regex must be updated. The strict
 * approach was chosen over a lenient one to avoid false positives.
 */
const LOG_REGEX = /^(\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\s+:\.*([\w]+):\s*([\w]+):\s*(.*)$/;

/**
 * Parses a single raw log line into a structured or unstructured ParsedLogLine.
 *
 * @param raw - The raw text of one line from the log file (may include trailing whitespace).
 * @param lineNumber - The 1-based line number to attach to this entry, used by the
 *                     frontend for display and by the watcher to track position.
 * @returns A ParsedLogLine object. If the line matches LOG_REGEX, all structured
 *          fields are populated and `isStructured` is true. Otherwise only `raw`,
 *          `id`, `lineNumber`, and `isStructured: false` are set.
 */
export function parseLogLine(raw: string, lineNumber: number): ParsedLogLine {
  // Trim only trailing whitespace — leading whitespace could be meaningful
  // (e.g., indented continuation lines in stack traces).
  const trimmed = raw.trimEnd();
  const match = trimmed.match(LOG_REGEX);

  if (match) {
    // Structured path — all five capture groups are available.
    idCounter += 1;
    return {
      id: String(idCounter),
      timestamp: match[1],
      level: match[2],
      module: match[3],
      function: match[4],
      // match[5] could be an empty string if the log line ends after "function:",
      // so coerce empty string to undefined for cleaner JSON output.
      message: match[5] || undefined,
      raw: trimmed,
      isStructured: true,
      lineNumber,
    };
  }

  // Unstructured path — the line did not match the expected format.
  // Still assign an ID and preserve the raw text so it can be displayed.
  idCounter += 1;
  return {
    id: String(idCounter),
    raw: trimmed,
    isStructured: false,
    lineNumber,
  };
}

/**
 * Parses a multi-line text block into an array of ParsedLogLine objects.
 *
 * This is the batch entry point used by the file watcher for both initial
 * file reads and incremental chunk reads. It splits on newlines, skips
 * blank lines, and delegates each non-empty line to `parseLogLine`.
 *
 * @param text - A string potentially containing multiple newline-separated log lines.
 *               Can be the entire file contents or just a newly appended chunk.
 * @param startLineNumber - The 1-based line number of the first line in `text`
 *                          relative to the original file. Defaults to 1 for full
 *                          file reads. For incremental reads, the file watcher
 *                          passes `totalLineCount + 1` so line numbers stay
 *                          globally consistent.
 * @returns An array of ParsedLogLine objects, one per non-empty line.
 *          Empty/whitespace-only lines are silently skipped to avoid noise.
 */
export function parseLogLines(text: string, startLineNumber: number = 1): ParsedLogLine[] {
  const lines = text.split('\n');
  const parsed: ParsedLogLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip blank lines — they carry no information and would create
    // empty unstructured entries that clutter the frontend.
    if (line.trim() === '') continue;
    // lineNumber = startLineNumber + i keeps numbering aligned with the
    // original file position, even when parsing a mid-file chunk.
    parsed.push(parseLogLine(line, startLineNumber + i));
  }

  return parsed;
}
