import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instancePaths } from './paths.js';
import { pidsHoldingFile, processCommand, processStartTime } from './processInfo.js';
import type { RunRecord } from './runRecord.js';
import { instanceState } from './state.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl state', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('instanceState is stopped when there is no run record and no process holds the changes file', async () => {
    // Given
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, '');
    await fs.writeFile(paths.changes, '');

    // When
    const state = await instanceState(home, 'demo');

    // Then
    expect(state).toEqual({ state: 'stopped' });
  });

  it('instanceState is running when the run record matches a live process whose command line contains the image path', async () => {
    // Given
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, '');
    await fs.writeFile(paths.changes, '');
    // `read` blocks on the open stdin pipe; $0 puts the image path in the command line.
    const child = spawn('sh', ['-c', 'read x', paths.image], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      const pid = child.pid as number;
      expect(await processCommand(pid)).toContain(paths.image);
      const record: RunRecord = {
        pid,
        startTime: (await processStartTime(pid)) as string,
        mode: 'headless',
        bridge: true,
        saveOnStop: false,
        startedAt: '2026-11-12T10:00:00.000Z',
      };
      await fs.writeFile(paths.runRecord, JSON.stringify(record));

      // When
      const state = await instanceState(home, 'demo');

      // Then
      expect(state).toEqual({
        state: 'running',
        pid,
        mode: 'headless',
        bridge: true,
        saveOnStop: false,
        startedAt: '2026-11-12T10:00:00.000Z',
      });
    } finally {
      child.kill();
    }
  });

  it('instanceState is stopped and leaves the run record untouched when the record is stale (dead pid, other start time, other command line)', async () => {
    // Given
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, '');
    await fs.writeFile(paths.changes, '');
    const baseRecord = {
      mode: 'headless',
      bridge: true,
      saveOnStop: false,
      startedAt: '2026-11-12T10:00:00.000Z',
    } as const;
    const live: Array<ReturnType<typeof spawn>> = [];
    const expectStaleAndUntouched = async (record: RunRecord): Promise<void> => {
      const written = JSON.stringify(record);
      await fs.writeFile(paths.runRecord, written);
      expect(await instanceState(home, 'demo')).toEqual({ state: 'stopped' });
      expect(await fs.readFile(paths.runRecord)).toEqual(Buffer.from(written));
    };
    try {
      // (a) dead pid
      const dead = spawn('true', [], { stdio: 'ignore' });
      await new Promise((resolve) => dead.once('exit', resolve));

      // (b) live process running this image, but a different start time
      const sameImage = spawn('sh', ['-c', 'read x', paths.image], { stdio: ['pipe', 'ignore', 'ignore'] });
      live.push(sameImage);

      // (c) live process with the correct start time, but not running this image
      const otherProgram = spawn('sh', ['-c', 'read x'], { stdio: ['pipe', 'ignore', 'ignore'] });
      live.push(otherProgram);
      const otherPid = otherProgram.pid as number;
      expect(await processCommand(otherPid)).not.toContain(paths.image);
      const otherStart = (await processStartTime(otherPid)) as string;

      // When / Then
      await expectStaleAndUntouched({
        ...baseRecord,
        pid: dead.pid as number,
        startTime: 'Thu Jan  1 00:00:00 1970',
      });
      await expectStaleAndUntouched({
        ...baseRecord,
        pid: sameImage.pid as number,
        startTime: 'Thu Jan  1 00:00:00 1970',
      });
      await expectStaleAndUntouched({ ...baseRecord, pid: otherPid, startTime: otherStart });
    } finally {
      for (const child of live) child.kill();
    }
  });

  it('instanceState is running_untracked with the holder pid when there is no run record but a process holds the changes file open', async () => {
    // Given
    const paths = instancePaths(home, 'demo');
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, '');
    await fs.writeFile(paths.changes, '');
    // $0 is the changes path; fd 3 keeps it open, like a VM holding its .changes file.
    const child = spawn('sh', ['-c', 'exec sleep 30 3<"$0"', paths.changes], { stdio: 'ignore' });
    try {
      const pid = child.pid as number;
      for (let attempt = 0; attempt < 50 && !(await pidsHoldingFile(paths.changes)).includes(pid); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await pidsHoldingFile(paths.changes)).toContain(pid);

      // When
      const state = await instanceState(home, 'demo');

      // Then
      expect(state).toEqual({ state: 'running_untracked', pid });
    } finally {
      child.kill();
    }
  });
});
