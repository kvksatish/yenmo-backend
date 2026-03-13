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

  it('handles file truncation by resetting offset and re-reading (RISK #3)', () => {
    const initial = '03/22 08:52:50 INFO   :.modA: funcA:  Line1\n03/22 08:52:51 INFO   :.modA: funcA:  Line2\n';
    fs.writeFileSync(logFilePath, initial, 'utf-8');

    const onNewLines = vi.fn();
    const onInit = vi.fn();

    startWatching(logFilePath, onNewLines, onInit);

    const changeHandler = mockWatcher.on.mock.calls.find(
      (call) => call[0] === 'change'
    )?.[1] as () => void;

    // Truncate the file and write shorter content
    const truncated = '03/22 09:00:00 ERROR  :.modC: funcC:  Fresh\n';
    fs.writeFileSync(logFilePath, truncated, 'utf-8');

    // Trigger change -- the watcher should detect that size < lastOffset
    changeHandler();

    // After truncation detection, since currentSize < lastOffset, offset resets to 0.
    // Then currentSize > 0 (new lastOffset), so it reads from 0.
    expect(onNewLines).toHaveBeenCalledOnce();
    const lines = onNewLines.mock.calls[0][0];
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('ERROR');
    expect(lines[0].message).toBe('Fresh');
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
});
