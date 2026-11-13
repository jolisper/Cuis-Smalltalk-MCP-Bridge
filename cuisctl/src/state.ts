/**
 * Single source of an instance's state. Read-only: never signals a process,
 * never writes or deletes anything.
 *
 * Decision order:
 *   1. valid run record (live process)  -> running
 *   2. changes file held by a process   -> running_untracked
 *   3. otherwise                        -> stopped
 * A stale record is ignored, never deleted.
 *
 * All three steps are implemented.
 */
import { CuisctlError } from './errors.js';
import { instancePaths } from './paths.js';
import { pidsHoldingFile, processCommand, processStartTime } from './processInfo.js';
import { readRunRecord, type RunRecord } from './runRecord.js';

export type InstanceState =
  | { state: 'stopped' }
  | {
      state: 'running';
      pid: number;
      mode: 'gui' | 'headless';
      bridge: boolean;
      saveOnStop: boolean;
      startedAt: string;
    }
  | { state: 'running_untracked'; pid: number };

/** True when the record's pid is still the process that wrote it, running this image. */
async function recordIsLive(record: RunRecord, imagePath: string): Promise<boolean> {
  return (
    (await processStartTime(record.pid)) === record.startTime &&
    ((await processCommand(record.pid)) ?? '').includes(imagePath)
  );
}

export async function instanceState(home: string, name: string): Promise<InstanceState> {
  const paths = instancePaths(home, name);
  const record = await readRunRecord(home, name);
  if (record !== undefined && (await recordIsLive(record, paths.image))) {
    const { pid, mode, bridge, saveOnStop, startedAt } = record;
    return { state: 'running', pid, mode, bridge, saveOnStop, startedAt };
  }
  const holders = await pidsHoldingFile(paths.changes);
  if (holders.length > 0) {
    return { state: 'running_untracked', pid: holders[0] };
  }
  return { state: 'stopped' };
}

/**
 * Throws `instance_running` unless the named instance is currently stopped.
 * Read-only like `instanceState`: never signals a process.
 */
export async function requireStopped(home: string, name: string): Promise<void> {
  if ((await instanceState(home, name)).state !== 'stopped') {
    throw new CuisctlError(
      'instance_running',
      `Instance "${name}" is running; stop it first`,
      `cuisctl stop ${name}`,
    );
  }
}
