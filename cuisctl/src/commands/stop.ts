/**
 * The cuisctl `stop` command.
 *
 * Flow:
 *  1. Validate the name and read the instance record (no version check).
 *  2. Under the per-instance lock, decide by the instance state: stopped (already_stopped) or running.
 *  3. Resolve the target VM: tracked (run record) or untracked (must be a Squeak VM, otherwise refuse).
 *  4. Without --save: kill the VM and remove the run record.
 *  5. With --save: snapshot the image stat, SIGTERM the VM, wait the save timeout, extend up to the hard cap
 *     while the image is changing, and kill it when the save does not complete (not_saved).
 *  6. Remove the run record and report the StopView.
 */
import { stat } from 'node:fs/promises';
import { CuisctlError } from '../errors.js';
import { instancePaths } from '../paths.js';
import { readInstance, validateName } from '../instance.js';
import type { Result } from '../output.js';
import { processCommand, processStartTime } from '../processInfo.js';
import { signalVm, waitForExit } from '../processControl.js';
import { readRunRecord, removeRunRecord } from '../runRecord.js';
import { instanceState, type InstanceState } from '../state.js';
import { errorResult } from './errorResult.js';
import { withInstanceLock } from './instanceLock.js';

const DEFAULT_SAVE_TIMEOUT_MS = 10_000;
const DEFAULT_HARD_CAP_MS = 60_000;
const DEFAULT_KILL_WAIT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export interface StopOptions {
  home: string;
  name: string;
  save?: boolean;
  saveTimeoutMs?: number;
  hardCapMs?: number;
  killWaitMs?: number;
  pollIntervalMs?: number;
}

export interface StopView {
  name: string;
  outcome: 'stopped' | 'already_stopped';
  saved: boolean;
  reason?: string;
}

interface StopTarget {
  pid: number;
  startTime: string;
  saveOnStop: boolean | undefined;
}

/** Messages of the not_saved error, kept in one place. */
const notSaved = {
  unavailable: () => new CuisctlError('not_saved', 'stopped, not saved: save on stop unavailable'),
  hardCap: (hardCapMs: number) =>
    new CuisctlError('not_saved', `stopped, not saved: the image did not finish saving within ${formatSeconds(hardCapMs)}`),
  timeout: (saveTimeoutMs: number) =>
    new CuisctlError('not_saved', `stopped, not saved: the image did not save within ${formatSeconds(saveTimeoutMs)}`),
  unchanged: () => new CuisctlError('not_saved', 'stopped, not saved: the image was not saved'),
};

function formatSeconds(ms: number): string {
  return `${ms / 1000} s`;
}

function stoppedResult(name: string, saved: boolean): Result {
  return { ok: true, command: 'stop', data: { name, outcome: 'stopped', saved } satisfies StopView };
}

/** Finds the VM to stop for a running instance; refuses to touch a process that is not a Squeak VM. */
async function resolveTarget(opts: StopOptions, state: Exclude<InstanceState, { state: 'stopped' }>): Promise<StopTarget> {
  if (state.state === 'running_untracked') {
    const command = await processCommand(state.pid);
    if (/(^|\/)Squeak( |$)/.test(command ?? '')) {
      const startTime = await processStartTime(state.pid);
      if (startTime !== undefined) {
        return { pid: state.pid, startTime, saveOnStop: true };
      }
    }
    throw new CuisctlError(
      'instance_running',
      `process ${state.pid} (${command}) holds the files of instance "${opts.name}" but is not a Squeak VM; not touching it`,
    );
  }
  const record = await readRunRecord(opts.home, opts.name);
  if (record === undefined) {
    throw new CuisctlError('instance_running', `the run record of instance "${opts.name}" disappeared while stopping it`);
  }
  return { pid: state.pid, startTime: record.startTime, saveOnStop: state.saveOnStop };
}

/** Kills the VM and removes its run record: the VM ended without a save. */
async function killAndForget(opts: StopOptions, target: StopTarget): Promise<void> {
  await signalVm(target.pid, target.startTime, 'SIGKILL');
  await waitForExit(target.pid, target.startTime, opts.killWaitMs ?? DEFAULT_KILL_WAIT_MS, opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  await removeRunRecord(opts.home, opts.name);
}

async function stopWithoutSave(opts: StopOptions, target: StopTarget): Promise<Result> {
  await killAndForget(opts, target);
  return stoppedResult(opts.name, false);
}

/** Stops the VM saving the image; throws not_saved when the save did not happen. */
async function stopWithSave(opts: StopOptions, target: StopTarget): Promise<Result> {
  if (target.saveOnStop === false) {
    await killAndForget(opts, target);
    throw notSaved.unavailable();
  }
  const { pid, startTime } = target;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const imagePath = instancePaths(opts.home, opts.name).image;

  // Snapshot the image, then ask the VM to quit (it saves on SIGTERM).
  const before = await stat(imagePath);
  const imageChanged = async (): Promise<{ changed: boolean }> => {
    const now = await stat(imagePath);
    return { changed: now.mtimeMs !== before.mtimeMs || now.size !== before.size };
  };
  await signalVm(pid, startTime, 'SIGTERM');
  const sigtermAt = Date.now();

  // Wait the save timeout.
  const saveTimeoutMs = opts.saveTimeoutMs ?? DEFAULT_SAVE_TIMEOUT_MS;
  let exited = await waitForExit(pid, startTime, saveTimeoutMs, pollMs);
  let { changed } = await imageChanged();

  // Extension: while the image is changing, keep waiting up to the hard cap.
  if (!exited && changed) {
    const hardCapMs = opts.hardCapMs ?? DEFAULT_HARD_CAP_MS;
    const remaining = Math.max(0, hardCapMs - (Date.now() - sigtermAt));
    exited = await waitForExit(pid, startTime, remaining, pollMs);
    if (!exited) {
      await killAndForget(opts, target);
      throw notSaved.hardCap(hardCapMs);
    }
    ({ changed } = await imageChanged());
  }

  if (!changed) {
    if (!exited) {
      await killAndForget(opts, target);
      throw notSaved.timeout(saveTimeoutMs);
    }
    await removeRunRecord(opts.home, opts.name);
    throw notSaved.unchanged();
  }
  await removeRunRecord(opts.home, opts.name);
  return stoppedResult(opts.name, true);
}

/** Runs the stop flow; never rejects, failures are returned as an error Result. */
export async function runStop(opts: StopOptions): Promise<Result> {
  try {
    validateName(opts.name);
    await readInstance(opts.home, opts.name);
    return await withInstanceLock(opts.home, opts.name, async (): Promise<Result> => {
      const state = await instanceState(opts.home, opts.name);
      if (state.state === 'stopped') {
        await removeRunRecord(opts.home, opts.name);
        return { ok: true, command: 'stop', data: { name: opts.name, outcome: 'already_stopped', saved: false } satisfies StopView };
      }
      const target = await resolveTarget(opts, state);
      return opts.save === true ? await stopWithSave(opts, target) : await stopWithoutSave(opts, target);
    });
  } catch (e) {
    return errorResult(e);
  }
}
