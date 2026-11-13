// The only module that signals processes.
//
// A VM is identified by pid plus start time, so a recycled pid is never
// mistaken for (or signalled as) the original VM.

import { processStartTime } from './processInfo.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls every `pollMs` until the VM identified by `pid` and `startTime` is gone
 * (no such process, or the pid now belongs to a process with a different start time).
 * Resolves true once it has exited, or false if it is still running after `timeoutMs`.
 */
export async function waitForExit(pid: number, startTime: string, timeoutMs: number, pollMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await processStartTime(pid);
    if (current === undefined || current !== startTime) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(pollMs);
  }
}

/**
 * Sends `signal` to `pid` only if its start time still matches `startTime`.
 * Returns true if the signal was sent, false if the process is gone or the pid was reused.
 */
export async function signalVm(pid: number, startTime: string, signal: NodeJS.Signals): Promise<boolean> {
  if ((await processStartTime(pid)) !== startTime) {
    return false;
  }
  process.kill(pid, signal);
  return true;
}
