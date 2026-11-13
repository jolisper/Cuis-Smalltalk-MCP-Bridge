import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instanceDir, instancePaths } from './paths.js';
import { readRunRecord, removeRunRecord, writeRunRecord, type RunRecord } from './runRecord.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl runRecord', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('readRunRecord on an instance with no run.json resolves undefined and writes nothing', async () => {
    // Given
    await fs.mkdir(instanceDir(home, 'demo'), { recursive: true });

    // When
    const record = await readRunRecord(home, 'demo');

    // Then
    expect(record).toBeUndefined();
    expect(await fs.readdir(instanceDir(home, 'demo'))).toEqual([]);
  });

  it('readRunRecord returns the parsed run.json record and leaves the file unchanged', async () => {
    // Given
    const expected = {
      pid: 4242,
      startTime: 'Thu Nov 12 10:00:00 2026',
      mode: 'headless',
      bridge: true,
      saveOnStop: false,
      startedAt: '2026-11-12T10:00:00.000Z',
    };
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.runRecord, JSON.stringify(expected));
    const bytesBefore = await fs.readFile(paths.runRecord);

    // When
    const record = await readRunRecord(home, 'demo');

    // Then
    expect(record).toEqual(expected);
    expect((await fs.readFile(paths.runRecord)).equals(bytesBefore)).toBe(true);
  });

  it('writeRunRecord writes run.json so readRunRecord returns an equal record', async () => {
    // Given
    const record: RunRecord = {
      pid: 4242,
      startTime: 'Thu Nov 12 10:00:00 2026',
      mode: 'headless',
      bridge: true,
      saveOnStop: false,
      startedAt: '2026-11-12T10:00:00.000Z',
    };
    await fs.mkdir(instanceDir(home, 'demo'), { recursive: true });

    // When
    await writeRunRecord(home, 'demo', record);

    // Then
    expect(await readRunRecord(home, 'demo')).toEqual(record);
  });

  it('writeRunRecord overwrites an existing run.json atomically via a temp file renamed onto run.json', async () => {
    // Given
    const oldRecord: RunRecord = {
      pid: 1111,
      startTime: 'Thu Nov 12 09:00:00 2026',
      mode: 'gui',
      bridge: false,
      saveOnStop: true,
      startedAt: '2026-11-12T09:00:00.000Z',
    };
    const newRecord: RunRecord = {
      pid: 4242,
      startTime: 'Thu Nov 12 10:00:00 2026',
      mode: 'headless',
      bridge: true,
      saveOnStop: false,
      startedAt: '2026-11-12T10:00:00.000Z',
    };
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.dir, { recursive: true });
    await writeRunRecord(home, 'demo', oldRecord);
    const entriesBefore = await fs.readdir(paths.dir);
    const renameSpy = vi.spyOn(fs, 'rename');

    // When
    try {
      await writeRunRecord(home, 'demo', newRecord);

      // Then
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy.mock.calls[0][1]).toBe(paths.runRecord);
      expect(await readRunRecord(home, 'demo')).toEqual(newRecord);
      expect(await fs.readdir(paths.dir)).toEqual(entriesBefore);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('removeRunRecord deletes run.json so readRunRecord returns undefined', async () => {
    // Given
    const record: RunRecord = {
      pid: 4242,
      startTime: 'Thu Nov 12 10:00:00 2026',
      mode: 'headless',
      bridge: true,
      saveOnStop: false,
      startedAt: '2026-11-12T10:00:00.000Z',
    };
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.dir, { recursive: true });
    await writeRunRecord(home, 'demo', record);

    // When
    await removeRunRecord(home, 'demo');

    // Then
    expect(await readRunRecord(home, 'demo')).toBeUndefined();
    await expect(fs.access(paths.runRecord)).rejects.toThrow();
  });

  it('removeRunRecord on an instance with no run.json resolves without throwing', async () => {
    // Given
    await fs.mkdir(instanceDir(home, 'demo'), { recursive: true });

    // When / Then
    await expect(removeRunRecord(home, 'demo')).resolves.toBeUndefined();
  });
});
