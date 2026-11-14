import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, isLockLive, releaseLock } from './lock.js';
import { processStartTime } from './processInfo.js';

describe('cuisctl lock', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-lock-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('acquireLock on a path with no existing lock resolves true and writes {pid, startTime}', async () => {
    // Given
    const lockFile = path.join(dir, 'x.lock');

    // When
    const acquired = await acquireLock(lockFile);

    // Then
    expect(acquired).toBe(true);
    const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    expect(content).toEqual({ pid: process.pid, startTime: await processStartTime(process.pid) });
  });

  it('isLockLive is true for a lock just acquired by this process and false for a missing lock file', async () => {
    // Given
    const lockFile = path.join(dir, 'x.lock');
    await acquireLock(lockFile);

    // When
    const live = await isLockLive(lockFile);
    const missing = await isLockLive(path.join(dir, 'missing.lock'));

    // Then
    expect(live).toBe(true);
    expect(missing).toBe(false);
  });

  it('isLockLive is false for a dead pid and for a live pid whose start time does not match', async () => {
    // Given
    const deadPid = spawnSync('true').pid;
    const deadLock = path.join(dir, 'dead.lock');
    const recycledLock = path.join(dir, 'recycled.lock');
    await fs.writeFile(deadLock, JSON.stringify({ pid: deadPid, startTime: 'Thu Jan  1 00:00:00 1970' }));
    await fs.writeFile(recycledLock, JSON.stringify({ pid: process.pid, startTime: 'Thu Jan  1 00:00:00 1970' }));

    // When
    const dead = await isLockLive(deadLock);
    const recycled = await isLockLive(recycledLock);

    // Then
    expect(dead).toBe(false);
    expect(recycled).toBe(false);
  });

  it('isLockLive is false for a lock file with unparseable (corrupt) content', async () => {
    // Given
    const lockFile = path.join(dir, 'x.lock');
    await fs.writeFile(lockFile, 'not json{');

    // When
    const live = isLockLive(lockFile);

    // Then
    await expect(live).resolves.toBe(false);
  });

  it('second acquireLock on a live lock resolves false, leaves the file unchanged and no temp siblings', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      const lockFile = path.join(dir, 'x.lock');
      await fs.writeFile(lockFile, JSON.stringify({ pid, startTime: await processStartTime(pid) }));
      const before = await fs.readFile(lockFile);

      // When
      const acquired = await acquireLock(lockFile);

      // Then
      expect(acquired).toBe(false);
      expect(await fs.readFile(lockFile)).toEqual(before);
      expect(await fs.readdir(dir)).toEqual(['x.lock']);
    } finally {
      child.kill();
    }
  });

  it('8 concurrent acquireLock calls on a stale lock (dead pid) yield exactly one true, over 20 iterations, leaving only the lock file', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.on('exit', resolve));
    const oldStart = 'Thu Jan  1 00:00:00 1970';

    for (let i = 0; i < 20; i++) {
      // Given
      const lockFile = path.join(dir, 'race.lock');
      await fs.writeFile(lockFile, JSON.stringify({ pid: child.pid, startTime: oldStart }));

      // When
      const results = await Promise.all(Array.from({ length: 8 }, () => acquireLock(lockFile)));

      // Then
      expect(results.filter((r) => r === true)).toHaveLength(1);
      expect(results.filter((r) => r === false)).toHaveLength(7);
      const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(await fs.readdir(dir)).toEqual(['race.lock']);
      await fs.rm(lockFile);
    }
  }, 60_000);

  it('a stale takeover marker left by a crashed process is removed, so a later acquireLock on the stale lock succeeds', async () => {
    // Given
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.on('exit', resolve));
    const stale = JSON.stringify({ pid: child.pid, startTime: 'Thu Jan  1 00:00:00 1970' });
    const lockFile = path.join(dir, 'x.lock');
    await fs.writeFile(lockFile, stale);
    await fs.writeFile(`${lockFile}.takeover`, stale);

    // When
    await acquireLock(lockFile);
    const acquired = await acquireLock(lockFile);

    // Then
    expect(acquired).toBe(true);
    const content = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    expect(content.pid).toBe(process.pid);
    await expect(fs.access(`${lockFile}.takeover`)).rejects.toThrow();
  });

  it('releaseLock removes a lock file acquired by this process', async () => {
    // Given
    const lockFile = path.join(dir, 'x.lock');
    await acquireLock(lockFile);

    // When
    await releaseLock(lockFile);

    // Then
    await expect(fs.access(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releaseLock leaves a lock owned by another live process untouched', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      const lockFile = path.join(dir, 'x.lock');
      await fs.writeFile(lockFile, JSON.stringify({ pid, startTime: await processStartTime(pid) }));
      const before = await fs.readFile(lockFile);

      // When
      await releaseLock(lockFile);

      // Then
      expect(await fs.readFile(lockFile)).toEqual(before);
    } finally {
      child.kill();
    }
  });

  it('releaseLock on a missing lock file is a no-op', async () => {
    // Given
    const lockFile = path.join(dir, 'missing.lock');

    // When
    const released = releaseLock(lockFile);

    // Then
    await expect(released).resolves.toBeUndefined();
  });
});
