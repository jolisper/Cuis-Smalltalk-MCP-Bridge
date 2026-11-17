/**
 * VM boot helpers shared by the commands that launch an instance VM: spawn it, wait for the ready
 * file, kill it, and turn a failed boot into a start_failed error carrying the vm.log tail.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CuisctlError } from './errors.js';
import { spawnVm } from './launcher.js';
import { CUIS_KEY, CUIS_VM_PATH } from './pin.js';
import { cuisDistDir, instancePaths } from './paths.js';
import { processStartTime } from './processInfo.js';
import { signalVm, waitForExit } from './processControl.js';
import { removeRunRecord } from './runRecord.js';

const KILL_WAIT_MS = 5000;
const KILL_POLL_MS = 50;
const LOG_TAIL_LINES = 20;

export type InstancePaths = ReturnType<typeof instancePaths>;

export interface LaunchedVm {
  pid: number;
  startTime: string;
  exited: Promise<number | null>;
  paths: InstancePaths;
}

export type ReadinessOutcome =
  | { kind: 'ready'; readyContent: string }
  | { kind: 'not_loopback_only' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'timeout' }
  | { kind: 'aborted' };

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function logTail(vmLog: string): Promise<string> {
  const log = await fs.readFile(vmLog, 'utf8').catch(() => '');
  return log.split('\n').slice(-LOG_TAIL_LINES).join('\n');
}

/** Drops the stale run record and ready file, writes the start script (content) and spawns the VM. */
export async function spawnInstanceVm(opts: {
  home: string;
  name: string;
  script: string;
  headless: boolean;
}): Promise<LaunchedVm> {
  await removeRunRecord(opts.home, opts.name);
  const paths = instancePaths(opts.home, opts.name);
  await fs.rm(paths.readyFile, { force: true });
  await fs.writeFile(paths.startScript, opts.script, 'utf8');
  const { pid, exited } = await spawnVm({
    vm: path.join(cuisDistDir(opts.home, CUIS_KEY), CUIS_VM_PATH),
    image: paths.image,
    script: paths.startScript,
    cwd: paths.files,
    logFile: paths.vmLog,
    headless: opts.headless,
  });
  const startTime = (await processStartTime(pid)) ?? '';
  return { pid, startTime, exited, paths };
}

/**
 * Polls for the ready file. `checkReady` runs once the file is readable: it may return a non-ready
 * outcome to stop, return undefined to accept, or throw to keep polling.
 */
export async function waitForReadiness(
  vm: LaunchedVm,
  opts: {
    startTimeoutMs: number;
    pollIntervalMs: number;
    checkReady?: (readyContent: string) => Promise<ReadinessOutcome | undefined>;
    signal?: AbortSignal;
  },
): Promise<ReadinessOutcome> {
  const deadline = Date.now() + opts.startTimeoutMs;
  let exitCode: number | null | undefined;
  void vm.exited.then((code) => {
    exitCode = code;
  });
  for (;;) {
    if (opts.signal?.aborted === true) return { kind: 'aborted' };
    try {
      const readyContent = await fs.readFile(vm.paths.readyFile, 'utf8');
      const rejected = await opts.checkReady?.(readyContent);
      if (rejected) return rejected;
      return { kind: 'ready', readyContent };
    } catch {
      if (exitCode !== undefined) return { kind: 'exited', code: exitCode };
      if (Date.now() >= deadline) return { kind: 'timeout' };
      await sleep(opts.pollIntervalMs);
    }
  }
}

export async function killVm({ pid, startTime }: LaunchedVm): Promise<void> {
  await signalVm(pid, startTime, 'SIGKILL');
  await waitForExit(pid, startTime, KILL_WAIT_MS, KILL_POLL_MS);
}

/** Turns a non-ready outcome into a start_failed error, killing the VM if it is still running. */
export async function failStart(
  name: string,
  vm: LaunchedVm,
  outcome: Exclude<ReadinessOutcome, { kind: 'ready' }>,
): Promise<never> {
  const subject = `Instance "${name}"`;
  let reason: string;
  if (outcome.kind === 'exited') {
    reason = `${subject} exited before becoming ready (code ${outcome.code}).`;
  } else {
    await killVm(vm);
    reason =
      outcome.kind === 'not_loopback_only'
        ? `${subject} bridge is not listening on 127.0.0.1 only (not loopback-only); the VM was killed.`
        : `${subject} did not become ready within the start timeout.`;
  }
  throw new CuisctlError('start_failed', `${reason}\n${await logTail(vm.paths.vmLog)}`);
}
