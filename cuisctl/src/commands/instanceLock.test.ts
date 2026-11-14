import { spawn } from 'node:child_process';
import fs, { access } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CuisctlError } from '../errors.js';
import { instanceLockFile, locksDir } from '../paths.js';
import { processStartTime } from '../processInfo.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { withInstanceLock } from './instanceLock.js';

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

describe('withInstanceLock', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('holds the instance lock file while fn runs, resolves with its result, and removes the lock file afterwards', async () => {
    // Given a fresh home with no locks directory
    const lockFile = instanceLockFile(home, 'demo');
    expect(await exists(locksDir(home))).toBe(false);
    let existedDuringFn = false;

    // When
    const result = await withInstanceLock(home, 'demo', async () => {
      existedDuringFn = await exists(lockFile);
      return 42;
    });

    // Then
    expect(result).toBe(42);
    expect(existedDuringFn).toBe(true);
    expect(await exists(lockFile)).toBe(false);
  });

  it('rejects with a busy CuisctlError without waiting or running fn when a live process holds the lock, leaving the holder lock untouched', async () => {
    // Given a lock held by a live other process
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      const lockFile = instanceLockFile(home, 'demo');
      await fs.mkdir(locksDir(home), { recursive: true });
      await fs.writeFile(lockFile, JSON.stringify({ pid, startTime: await processStartTime(pid) }));
      const before = await fs.readFile(lockFile);
      let fnCalled = false;

      // When
      const started = Date.now();
      const outcome = await withInstanceLock(home, 'demo', async () => {
        fnCalled = true;
        return 1;
      }).then(
        () => undefined,
        (e: unknown) => e,
      );
      const elapsed = Date.now() - started;

      // Then
      expect(outcome).toBeInstanceOf(CuisctlError);
      expect((outcome as CuisctlError).kind).toBe('busy');
      expect((outcome as CuisctlError).message).toContain('demo');
      expect(fnCalled).toBe(false);
      expect(elapsed).toBeLessThan(1000);
      expect(await fs.readFile(lockFile)).toEqual(before);
    } finally {
      child.kill();
    }
  });

  it('rejects with the same error when fn throws and releases the lock so a later call succeeds', async () => {
    // Given an fn that throws
    const boom = new Error('boom');

    // When
    const outcome = await withInstanceLock(home, 'demo', async () => {
      throw boom;
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    // Then the same error propagates and the lock file is gone
    expect(outcome).toBe(boom);
    expect(await exists(instanceLockFile(home, 'demo'))).toBe(false);
    expect(await withInstanceLock(home, 'demo', async () => 'again')).toBe('again');
  });

  it('does not block a different instance when another instance lock is held by a live process', async () => {
    // Given instance 'a' locked by a live other process
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      await fs.mkdir(locksDir(home), { recursive: true });
      await fs.writeFile(
        instanceLockFile(home, 'a'),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When locking instance 'b'
      const result = await withInstanceLock(home, 'b', async () => 'ok');

      // Then
      expect(result).toBe('ok');
    } finally {
      child.kill();
    }
  });
});
