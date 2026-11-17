import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureOutput, parseOutcomeFile } from './runOutcome.js';
import { makeTempHome } from './testSupport/tempHome.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('cuisctl runOutcome', () => {
  it('parseOutcomeFile parses a complete passed outcome file into a ParsedOutcome', () => {
    // Given
    const text = 'status=passed\nelapsedMs=12\nresult=7\nresultTruncated=false\nerror=\ndone\n';

    // When
    const outcome = parseOutcomeFile(text);

    // Then
    expect(outcome).toEqual({
      status: 'passed',
      elapsedMs: 12,
      result: '7',
      resultTruncated: false,
      error: '',
    });
  });

  it.each([
    ['result', 'a\\nb', 'a\nb'],
    ['result', 'a\\\\nb', 'a\\nb'],
    ['error', 'x\\ry', 'x\ry'],
    ['error', 'C:\\\\dir', 'C:\\dir'],
  ])('parseOutcomeFile unescapes the %s field in a single pass: %s', (field, raw, expected) => {
    // Given a failed outcome whose result or error field holds escaped text
    const result = field === 'result' ? raw : '';
    const error = field === 'error' ? raw : '';
    const text = `status=failed\nelapsedMs=3\nresult=${result}\nresultTruncated=false\nerror=${error}\ndone\n`;

    // When
    const outcome = parseOutcomeFile(text);

    // Then
    expect(outcome?.[field as 'result' | 'error']).toBe(expected);
  });

  it('parseOutcomeFile caps an oversized result at 4096 characters and marks it truncated', () => {
    // Given an outcome whose result exceeds the cap although the VM reported no truncation
    const text = `status=passed\nelapsedMs=5\nresult=${'x'.repeat(5000)}\nresultTruncated=false\nerror=\ndone\n`;

    // When
    const outcome = parseOutcomeFile(text);

    // Then
    expect(outcome?.result).toBe('x'.repeat(4096));
    expect(outcome?.resultTruncated).toBe(true);
  });

  it.each([
    ['a file without the final done line', 'status=passed\nelapsedMs=12\nresult=7\nresultTruncated=false\nerror=\n'],
    ['a file truncated mid-line', 'status=passed\nelapsedMs=1'],
  ])('parseOutcomeFile returns undefined for a partial write: %s', (_label, text) => {
    // Given a partially written outcome file (text)

    // When
    const outcome = parseOutcomeFile(text);

    // Then
    expect(outcome).toBeUndefined();
  });

  it('captureOutput returns the bytes between the BEGIN and END nonce lines', async () => {
    // Given a log with boot noise, a nonce-delimited code output and trailing text
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    await fs.writeFile(logFile, 'boot noise\n\nn1 BEGIN\nhello\nworld\n\nn1 END\nafter\n');

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then
    expect(captured).toEqual({ output: 'hello\nworld\n', outputBytes: 12, outputTruncated: false });
  });

  it('captureOutput skips a BEGIN marker that lies before the offset', async () => {
    // Given a log holding an old run followed by a new run with the same nonce
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    const oldPart = '\nn1 BEGIN\nold\n\nn1 END\n';
    const newPart = '\nn1 BEGIN\nnew\n\nn1 END\n';
    await fs.writeFile(logFile, oldPart + newPart);
    const offset = Buffer.byteLength(oldPart);

    // When
    const captured = await captureOutput(logFile, offset, 'n1');

    // Then
    expect(captured).toEqual({ output: 'new\n', outputBytes: 4, outputTruncated: false });
  });

  it('captureOutput returns everything after BEGIN when the VM died before END', async () => {
    // Given a log whose run was killed mid-output, so no END line was written
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    await fs.writeFile(logFile, 'boot\n\nn1 BEGIN\npartial output');

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then
    expect(captured).toEqual({ output: 'partial output', outputBytes: 14, outputTruncated: false });
  });

  it.each([
    [
      'keeps the first 16 KB and last 48 KB of a 100000-byte output',
      'a'.repeat(16384) + 'm'.repeat(34464) + 'z'.repeat(49152),
      { outputBytes: 100000, outputTruncated: true },
    ],
    [
      'returns an output of exactly 64 KB whole',
      'q'.repeat(65536),
      { outputBytes: 65536, outputTruncated: false },
    ],
  ])('captureOutput %s', async (_label, body, expected) => {
    // Given a log whose nonce-delimited output is (body.length) bytes long
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    await fs.writeFile(logFile, '\nn1 BEGIN\n' + body + '\nn1 END\n');

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then
    expect(captured.outputBytes).toBe(expected.outputBytes);
    expect(captured.outputTruncated).toBe(expected.outputTruncated);
    if (expected.outputTruncated) {
      expect(captured.output).toHaveLength(65536);
      expect(captured.output.startsWith('a'.repeat(16384))).toBe(true);
      expect(captured.output.endsWith('z'.repeat(49152))).toBe(true);
      expect(captured.output).not.toContain('m');
    } else {
      expect(captured.output).toBe(body);
    }
  });

  it('captureOutput reads bounded windows through a file handle and never loads the whole log', async () => {
    // Given a 5 MB log whose output floods far past the 64 KB cap
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    await fs.writeFile(
      logFile,
      'boot\n' + '\nn1 BEGIN\n' + 'a'.repeat(16384) + 'm'.repeat(5_000_000) + 'z'.repeat(49152) + '\nn1 END\nafter\n',
    );
    const fsp = await import('node:fs/promises');
    vi.mocked(fsp.readFile).mockClear();

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then the head and tail are kept, and the whole log was never read into memory
    expect(captured.outputBytes).toBe(5065536);
    expect(captured.outputTruncated).toBe(true);
    expect(captured.output).toBe('a'.repeat(16384) + 'z'.repeat(49152));
    const readPaths = vi.mocked(fsp.readFile).mock.calls.map((call) => String(call[0]));
    expect(readPaths).not.toContain(logFile);
  });

  it('captureOutput decodes a multi-byte character split by the head cut as a replacement character', async () => {
    // Given a log whose output has a 3-byte UTF-8 character straddling the 16 KB head cut
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    const body = Buffer.concat([
      Buffer.from('a'.repeat(16383)),
      Buffer.from([0xe2, 0x82, 0xac]),
      Buffer.from('m'.repeat(40000)),
      Buffer.from('z'.repeat(49152)),
    ]);
    await fs.writeFile(
      logFile,
      Buffer.concat([Buffer.from('\nn1 BEGIN\n'), body, Buffer.from('\nn1 END\n')]),
    );

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then the split character degrades to U+FFFD and the rest of head and tail is intact
    expect(captured.outputTruncated).toBe(true);
    expect(captured.outputBytes).toBe(105538);
    expect(captured.output).toContain('�');
    expect(captured.output).not.toContain('€');
    expect(captured.output.startsWith('a'.repeat(16383))).toBe(true);
    expect(captured.output.endsWith('z'.repeat(49152))).toBe(true);
  });

  it('captureOutput strips the Transcript line prefix from every captured line and counts raw bytes', async () => {
    // Given a log where every line carries the timestamp/process prefix (Transcript logToStdout)
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    const P = '2026-11-16T00:18:38.078 process:40 755114 ';
    await fs.writeFile(
      logFile,
      `${P}boot noise\n${P}\n${P}n1 BEGIN\n${P}hello\n${P}world\n${P}\n${P}n1 END\n${P}after\n`,
    );

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then the prefixes are removed from the output, while outputBytes is the raw range length
    expect(captured).toEqual({
      output: 'hello\nworld\n',
      outputBytes: Buffer.byteLength(`${P}hello\n${P}world\n${P}`),
      outputTruncated: false,
    });
  });

  it('captureOutput returns empty output when the log has no BEGIN marker', async () => {
    // Given a log with only boot noise, as when the VM died before the code started
    const { home, cleanup } = await makeTempHome();
    cleanups.push(cleanup);
    const logFile = path.join(home, 'vm.log');
    await fs.writeFile(logFile, 'boot noise only\n');

    // When
    const captured = await captureOutput(logFile, 0, 'n1');

    // Then
    expect(captured).toEqual({ output: '', outputBytes: 0, outputTruncated: false });
  });
});
