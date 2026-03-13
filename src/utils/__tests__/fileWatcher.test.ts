import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock chokidar before importing the module under test.
// We capture the event handlers so we can trigger them manually.
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
};

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

// We need to dynamically import after mocking
const { startWatching } = await import('../fileWatcher.js');

describe('fileWatcher', () => {
  let tmpDir: string;
  let logFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
    logFilePath = path.join(tmpDir, 'test.log');
    mockWatcher.on.mockClear();

    // Reset the module-level state between tests by re-importing would be ideal,
    // but since we're testing behavior through callbacks, we handle this via
    // isolated file paths.
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads initial file contents and calls onInit with parsed lines', () => {
    const content = '03/22 08:52:50 INFO   :.modA: funcA:  Hello\nplain line\n';
    fs.writeFileSync(logFilePath, content, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(logFilePath, onNewLines, onInit);

    expect(onInit).toHaveBeenCalledOnce();
    const lines = onInit.mock.calls[0][0];
    expect(lines).toHaveLength(2);
    expect(lines[0].isStructured).toBe(true);
    expect(lines[0].level).toBe('INFO');
    expect(lines[1].isStructured).toBe(false);
    expect(lines[1].raw).toBe('plain line');
  });

  it('detects new bytes appended and calls onNewLines via change event', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  First\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(logFilePath, onNewLines, onInit);

    // Grab the 'change' handler registered with chokidar
    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;
    expect(changeHandler).toBeDefined();

    // Append new data to the file
    const appended = '03/22 08:53:00 WARN   :.modB: funcB:  Second\n';
    fs.appendFileSync(logFilePath, appended, 'utf-8');

    // Trigger the change event
    changeHandler();

    expect(onNewLines).toHaveBeenCalledOnce();
    const newLines = onNewLines.mock.calls[0][0];
    expect(newLines).toHaveLength(1);
    expect(newLines[0].level).toBe('WARN');
    expect(newLines[0].message).toBe('Second');
  });

  it('handles file truncation by resetting offset and calling onTruncate (RISK #3)', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  Line1\n03/22 08:52:51 INFO   :.modA: funcA:  Line2\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();
    const onTruncate = vi.fn();

    startWatching(logFilePath, onNewLines, onInit, onTruncate);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // Truncate the file and write shorter content
    const truncated = '03/22 09:00:00 ERROR  :.modC: funcC:  Fresh\n';
    fs.writeFileSync(logFilePath, truncated, 'utf-8');

    // Trigger change -- the watcher should detect that size < lastOffset
    changeHandler();

    // onTruncate should be called (not onNewLines) with the new file content
    expect(onNewLines).not.toHaveBeenCalled();
    expect(onTruncate).toHaveBeenCalledOnce();
    const lines = onTruncate.mock.calls[0][0];
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('ERROR');
    expect(lines[0].message).toBe('Fresh');
    expect(lines[0].lineNumber).toBe(1); // line numbers reset to 1
  });

  it('handles empty file on startup', () => {
    fs.writeFileSync(logFilePath, '', 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(logFilePath, onNewLines, onInit);

    expect(onInit).toHaveBeenCalledOnce();
    const lines = onInit.mock.calls[0][0];
    expect(lines).toHaveLength(0);
  });

  it('handles file not existing on startup (ENOENT)', () => {
    const nonExistentPath = path.join(tmpDir, 'does-not-exist.log');
    const onNewLines = vi.fn();
    const onInit = vi.fn();

    // Should not throw
    expect(() => {
      startWatching(nonExistentPath, onNewLines, onInit);
    }).not.toThrow();

    // onInit should NOT be called when file doesn't exist
    expect(onInit).not.toHaveBeenCalled();
  });

  it('handles file creation after watcher starts via add event', () => {
    const newFilePath = path.join(tmpDir, 'created-later.log');
    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(newFilePath, onNewLines, onInit);

    // File didn't exist, so onInit not called during startWatching
    expect(onInit).not.toHaveBeenCalled();

    // Now create the file
    const content = '03/22 10:00:00 DEBUG  :.modD: funcD:  Created\n';
    fs.writeFileSync(newFilePath, content, 'utf-8');

    // Grab the 'add' handler
    const addHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'add'
    )?.[1] as () => void;
    expect(addHandler).toBeDefined();

    // Trigger the add event
    addHandler();

    expect(onInit).toHaveBeenCalledOnce();
    const lines = onInit.mock.calls[0][0];
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('DEBUG');
  });

  it('handles multiple appends correctly', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  First\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(logFilePath, onNewLines, onInit);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // First append
    fs.appendFileSync(logFilePath, '03/22 08:53:00 WARN   :.modB: funcB:  Second\n', 'utf-8');
    changeHandler();

    // Second append
    fs.appendFileSync(logFilePath, '03/22 08:54:00 ERROR  :.modC: funcC:  Third\n', 'utf-8');
    changeHandler();

    expect(onNewLines).toHaveBeenCalledTimes(2);
    expect(onNewLines.mock.calls[0][0][0].message).toBe('Second');
    expect(onNewLines.mock.calls[1][0][0].message).toBe('Third');
  });

  it('registers an error handler on the watcher', () => {
    fs.writeFileSync(logFilePath, '', 'utf-8');

    startWatching(logFilePath, vi.fn(), vi.fn());

    const errorRegistered = mockWatcher.on.mock.calls.some(
      (call) => call[0] === 'error'
    );
    expect(errorRegistered).toBe(true);
  });

  it('truncation without onTruncate callback does not crash (backward compat)', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  Line1\n03/22 08:52:51 INFO   :.modA: funcA:  Line2\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    // No onTruncate callback provided
    startWatching(logFilePath, onNewLines, onInit);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // Truncate the file
    fs.writeFileSync(logFilePath, '03/22 09:00:00 ERROR  :.modC: funcC:  Fresh\n', 'utf-8');

    // Should not throw even though onTruncate was not provided
    expect(() => changeHandler()).not.toThrow();

    // onNewLines should NOT be called on truncation
    expect(onNewLines).not.toHaveBeenCalled();
  });

  it('line numbers reset to 1 after truncation then subsequent appends continue correctly', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  Line1\n03/22 08:52:51 INFO   :.modA: funcA:  Line2\n03/22 08:52:52 INFO   :.modA: funcA:  Line3\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();
    const onTruncate = vi.fn();

    startWatching(logFilePath, onNewLines, onInit, onTruncate);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // Verify initial read had 3 lines
    expect(onInit).toHaveBeenCalledOnce();
    expect(onInit.mock.calls[0][0]).toHaveLength(3);
    expect(onInit.mock.calls[0][0][2].lineNumber).toBe(3);

    // Truncate with a single line
    fs.writeFileSync(logFilePath, '03/22 09:00:00 WARN   :.modX: funcX:  Reset\n', 'utf-8');
    changeHandler();

    expect(onTruncate).toHaveBeenCalledOnce();
    const truncatedLines = onTruncate.mock.calls[0][0];
    expect(truncatedLines).toHaveLength(1);
    expect(truncatedLines[0].lineNumber).toBe(1); // line numbers reset

    // Now append after truncation
    fs.appendFileSync(logFilePath, '03/22 09:01:00 INFO   :.modY: funcY:  After\n', 'utf-8');
    changeHandler();

    expect(onNewLines).toHaveBeenCalledOnce();
    const appendedLines = onNewLines.mock.calls[0][0];
    expect(appendedLines).toHaveLength(1);
    expect(appendedLines[0].lineNumber).toBe(2); // continues from 1 (the truncated line)
    expect(appendedLines[0].message).toBe('After');
  });

  it('handles rapid append → truncate → append sequence', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  Start\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();
    const onTruncate = vi.fn();

    startWatching(logFilePath, onNewLines, onInit, onTruncate);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // Step 1: Append
    fs.appendFileSync(logFilePath, '03/22 08:53:00 INFO   :.modA: funcA:  Appended1\n', 'utf-8');
    changeHandler();

    expect(onNewLines).toHaveBeenCalledTimes(1);
    expect(onNewLines.mock.calls[0][0][0].message).toBe('Appended1');
    expect(onNewLines.mock.calls[0][0][0].lineNumber).toBe(2);

    // Step 2: Truncate
    fs.writeFileSync(logFilePath, '03/22 09:00:00 ERROR  :.modC: funcC:  Rotated\n', 'utf-8');
    changeHandler();

    expect(onTruncate).toHaveBeenCalledOnce();
    expect(onTruncate.mock.calls[0][0][0].lineNumber).toBe(1);
    expect(onTruncate.mock.calls[0][0][0].message).toBe('Rotated');

    // Step 3: Append after truncation
    fs.appendFileSync(logFilePath, '03/22 09:01:00 DEBUG  :.modD: funcD:  PostRotate\n', 'utf-8');
    changeHandler();

    expect(onNewLines).toHaveBeenCalledTimes(2);
    const postRotateLines = onNewLines.mock.calls[1][0];
    expect(postRotateLines).toHaveLength(1);
    expect(postRotateLines[0].lineNumber).toBe(2);
    expect(postRotateLines[0].message).toBe('PostRotate');
    expect(postRotateLines[0].level).toBe('DEBUG');
  });
});
