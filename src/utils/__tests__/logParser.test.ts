import { describe, it, expect, beforeEach } from 'vitest';
import { parseLogLine, parseLogLines } from '../logParser.js';

describe('parseLogLine', () => {
  it('parses a structured INFO log line correctly', () => {
    const raw = '03/22 08:52:50 INFO   :...init_policyAPI: open_socket:  Entering';
    const result = parseLogLine(raw, 1);

    expect(result.isStructured).toBe(true);
    expect(result.timestamp).toBe('03/22 08:52:50');
    expect(result.level).toBe('INFO');
    expect(result.module).toBe('init_policyAPI');
    expect(result.function).toBe('open_socket');
    expect(result.message).toBe('Entering');
    expect(result.lineNumber).toBe(1);
    expect(result.raw).toBe(raw);
    expect(result.id).toBeDefined();
  });

  it('parses a WARN level log line', () => {
    const raw = '03/22 09:00:00 WARN   :.myModule: myFunc:  Something happened';
    const result = parseLogLine(raw, 5);

    expect(result.isStructured).toBe(true);
    expect(result.level).toBe('WARN');
    expect(result.module).toBe('myModule');
    expect(result.function).toBe('myFunc');
    expect(result.message).toBe('Something happened');
  });

  it('parses an ERROR level log line', () => {
    const raw = '03/22 10:15:30 ERROR  :.errorModule: handleError:  Connection refused';
    const result = parseLogLine(raw, 10);

    expect(result.isStructured).toBe(true);
    expect(result.level).toBe('ERROR');
    expect(result.module).toBe('errorModule');
    expect(result.function).toBe('handleError');
  });

  it('parses a DEBUG level log line', () => {
    const raw = '03/22 11:00:00 DEBUG  :.debugMod: debugFn:  variable=42';
    const result = parseLogLine(raw, 3);

    expect(result.isStructured).toBe(true);
    expect(result.level).toBe('DEBUG');
  });

  it('parses a TRACE level log line', () => {
    const raw = '03/22 11:00:00 TRACE  :.traceMod: traceFn:  entering loop';
    const result = parseLogLine(raw, 7);

    expect(result.isStructured).toBe(true);
    expect(result.level).toBe('TRACE');
  });

  it('returns isStructured: false for unstructured lines', () => {
    const raw = 'hello world';
    const result = parseLogLine(raw, 1);

    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe('hello world');
    expect(result.timestamp).toBeUndefined();
    expect(result.level).toBeUndefined();
    expect(result.module).toBeUndefined();
    expect(result.function).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it('assigns the correct line number', () => {
    const result = parseLogLine('some text', 42);
    expect(result.lineNumber).toBe(42);
  });

  it('generates unique IDs for each call', () => {
    const r1 = parseLogLine('line one', 1);
    const r2 = parseLogLine('line two', 2);
    const r3 = parseLogLine('line three', 3);

    expect(r1.id).not.toBe(r2.id);
    expect(r2.id).not.toBe(r3.id);
    expect(r1.id).not.toBe(r3.id);
  });

  it('handles an empty string', () => {
    const result = parseLogLine('', 1);

    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe('');
    expect(result.lineNumber).toBe(1);
    expect(result.id).toBeDefined();
  });

  it('handles lines with special characters', () => {
    const raw = 'Error: file not found [/tmp/foo.log] <>&"';
    const result = parseLogLine(raw, 1);

    expect(result.isStructured).toBe(false);
    expect(result.raw).toBe(raw);
  });

  it('trims trailing whitespace from raw', () => {
    const raw = '03/22 08:52:50 INFO   :.modA: funcB:  msg   \t  ';
    const result = parseLogLine(raw, 1);

    expect(result.isStructured).toBe(true);
    expect(result.raw).toBe(raw.trimEnd());
    expect(result.message).toBe('msg');
  });

  it('handles structured line with empty message', () => {
    const raw = '03/22 08:52:50 INFO   :.modA: funcB:  ';
    const result = parseLogLine(raw, 1);

    // The regex will match but match[5] is empty string, which becomes undefined
    expect(result.isStructured).toBe(true);
    expect(result.message).toBeUndefined();
  });
});

describe('parseLogLines', () => {
  it('splits multi-line text and parses each line', () => {
    const text = [
      '03/22 08:52:50 INFO   :.modA: funcA:  First',
      '03/22 08:52:51 WARN   :.modB: funcB:  Second',
      'plain text line',
    ].join('\n');

    const results = parseLogLines(text, 1);

    expect(results).toHaveLength(3);
    expect(results[0].isStructured).toBe(true);
    expect(results[0].level).toBe('INFO');
    expect(results[0].lineNumber).toBe(1);
    expect(results[1].isStructured).toBe(true);
    expect(results[1].level).toBe('WARN');
    expect(results[1].lineNumber).toBe(2);
    expect(results[2].isStructured).toBe(false);
    expect(results[2].lineNumber).toBe(3);
  });

  it('skips empty lines', () => {
    const text = 'line one\n\n\nline four\n';
    const results = parseLogLines(text, 1);

    expect(results).toHaveLength(2);
    expect(results[0].raw).toBe('line one');
    expect(results[0].lineNumber).toBe(1);
    expect(results[1].raw).toBe('line four');
    expect(results[1].lineNumber).toBe(4);
  });

  it('handles text with no trailing newline', () => {
    const text = 'first line\nsecond line';
    const results = parseLogLines(text, 1);

    expect(results).toHaveLength(2);
    expect(results[0].raw).toBe('first line');
    expect(results[1].raw).toBe('second line');
  });

  it('handles text with a trailing newline (last split element is empty)', () => {
    const text = 'first line\nsecond line\n';
    const results = parseLogLines(text, 1);

    expect(results).toHaveLength(2);
  });

  it('uses custom startLineNumber', () => {
    const text = 'line a\nline b';
    const results = parseLogLines(text, 50);

    expect(results[0].lineNumber).toBe(50);
    expect(results[1].lineNumber).toBe(51);
  });

  it('defaults startLineNumber to 1', () => {
    const text = 'hello';
    const results = parseLogLines(text);

    expect(results[0].lineNumber).toBe(1);
  });

  it('returns empty array for empty string', () => {
    const results = parseLogLines('', 1);
    expect(results).toHaveLength(0);
  });

  it('returns empty array for whitespace-only string', () => {
    const results = parseLogLines('   \n  \n   ', 1);
    expect(results).toHaveLength(0);
  });
});
