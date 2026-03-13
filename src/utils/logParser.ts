export interface ParsedLogLine {
  id: string;
  timestamp?: string;
  level?: string;
  module?: string;
  function?: string;
  message?: string;
  raw: string;
  isStructured: boolean;
  lineNumber: number;
}

let idCounter = 0;

// Matches: 03/22 08:52:50 INFO   :.......init_policyAPI: open_socket:  Entering
const LOG_REGEX = /^(\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\s+:\.*([\w]+):\s*([\w]+):\s*(.*)$/;

export function parseLogLine(raw: string, lineNumber: number): ParsedLogLine {
  const trimmed = raw.trimEnd();
  const match = trimmed.match(LOG_REGEX);

  if (match) {
    idCounter += 1;
    return {
      id: String(idCounter),
      timestamp: match[1],
      level: match[2],
      module: match[3],
      function: match[4],
      message: match[5] || undefined,
      raw: trimmed,
      isStructured: true,
      lineNumber,
    };
  }

  idCounter += 1;
  return {
    id: String(idCounter),
    raw: trimmed,
    isStructured: false,
    lineNumber,
  };
}

export function parseLogLines(text: string, startLineNumber: number = 1): ParsedLogLine[] {
  const lines = text.split('\n');
  const parsed: ParsedLogLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    parsed.push(parseLogLine(line, startLineNumber + i));
  }

  return parsed;
}
