import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { signalVm, waitForExit } from './processControl.js';
import { processStartTime } from './processInfo.js';

describe('cuisctl processControl', () => {
  it('signals a live process whose start time matches and reports true', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const startTime = (await processStartTime(child.pid!))!;
      const exited = new Promise<NodeJS.Signals | null>((resolve) =>
        child.on('exit', (_code, signal) => resolve(signal)),
      );

      // When
      const signaled = await signalVm(child.pid!, startTime, 'SIGKILL');

      // Then
      expect(signaled).toBe(true);
      await expect(exited).resolves.toBe('SIGKILL');
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('does not signal a live process whose start time differs and reports false', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      let exitedEarly = false;
      child.on('exit', () => {
        exitedEarly = true;
      });

      // When
      const signaled = await signalVm(child.pid!, 'Mon Jan  1 00:00:00 2001', 'SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then
      expect(signaled).toBe(false);
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
      expect(exitedEarly).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('waitForExit resolves true once the process is gone', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const startTime = (await processStartTime(child.pid!))!;
      setTimeout(() => child.kill('SIGKILL'), 100);

      // When
      const exited = await waitForExit(child.pid!, startTime, 5000, 20);

      // Then
      expect(exited).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('waitForExit resolves false after the timeout when the process is still alive', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const startTime = (await processStartTime(child.pid!))!;
      const began = Date.now();

      // When
      const exited = await waitForExit(child.pid!, startTime, 200, 20);
      const elapsed = Date.now() - began;

      // Then
      expect(exited).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(190);
      expect(elapsed).toBeLessThan(2000);
    } finally {
      child.kill('SIGKILL');
    }
  }, 5000);
});
