/**
 * The cuisctl `run` command: boots a stopped instance, runs one piece of Smalltalk code in it and
 * reports the outcome. Input resolution (code text, file or stdin, timeout parsing) lives in
 * runCli, not here; this module receives the code as a string.
 *
 * Flow (runOnce, under the per-instance lock; runRun validates the name and Cuis version first):
 *  1. Guards: the instance must be stopped (else instance_running) and the signal not yet aborted.
 *  2. Prepare: ensureHome, write the code file (verbatim) and the run script (with a random
 *     nonce), drop the stale outcome file, note the vm.log size and back up the image.
 *  3. Launch the VM (headless by default, GUI when headless is false) and wait for readiness. A boot
 *     that is not ready is start_failed; an abort during boot is interrupted. Once ready, a run
 *     record is written so other commands see the instance as running.
 *  4. Await the code: poll until a complete outcome file parses, the timeout passes (timed_out),
 *     the VM exits (failed, "VM ended") or the signal aborts (failed, then runRun reports it as
 *     interrupted). The output printed between the nonce markers in vm.log is captured.
 *  5. Finish by status: the outcome file gives passed or failed (with result or error).
 *  6. Restore and clean up (always, in `finally`).
 *  7. Report: runRun maps the RunView to a Result (run_failed, run_timed_out, interrupted, or
 *     not_saved when save could not save).
 *
 * save: only after a passed run, stop the VM with save so the image changes persist (saved=true). If
 * the save is not confirmed the error kind is not_saved and the RunView is still returned as data.
 * detach: hand the live VM over to the caller; it is neither killed nor restored and its run
 *   record stays (detached=true).
 *
 * Restore rules: unless the image was saved or the VM handed over, the VM is killed, the run record
 * removed and the image restored from the backup taken before launch. The backup and the temporary
 * run files (code, script, outcome) are always removed.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { definedOnly } from '../definedOnly.js';
import { CuisctlError } from '../errors.js';
import { ensureHome } from '../home.js';
import { instanceState } from '../state.js';
import { readInstance, requireCurrentCuisVersion, validateName } from '../instance.js';
import type { Result, RunView } from '../output.js';
import { backupImage, restoreImage } from '../imageBackup.js';
import { instancePaths } from '../paths.js';
import { captureOutput, parseOutcomeFile } from '../runOutcome.js';
import type { ParsedOutcome } from '../runOutcome.js';
import { buildRunScript, signalTrapPackageFile } from '../startScript.js';
import { removeRunRecord, writeRunRecord } from '../runRecord.js';
import { killVm, sleep, spawnInstanceVm, failStart, waitForReadiness } from '../vmBoot.js';
import type { InstancePaths, LaunchedVm } from '../vmBoot.js';
import { errorResult } from './errorResult.js';
import { withInstanceLock } from './instanceLock.js';
import { stopWithSave } from './stop.js';

const DEFAULT_START_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export interface RunOptions {
  home: string;
  name: string;
  code: string;
  timeoutSeconds: number;
  headless?: boolean;
  save?: boolean;
  detach?: boolean;
  onProgress: (message: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  archiveUrl?: string;
  archiveSha256?: string;
  unzip?: string;
  smokeTimeoutMs?: number;
}

async function prepareHome(opts: RunOptions): Promise<void> {
  const { archiveUrl, archiveSha256, unzip, smokeTimeoutMs } = opts;
  const setup = definedOnly({ archiveUrl, archiveSha256, unzip, smokeTimeoutMs });
  await ensureHome({ home: opts.home, ...setup }, opts.onProgress);
}

async function writeRunFiles(paths: InstancePaths, code: string, nonce: string): Promise<void> {
  await fs.writeFile(paths.runCode, code, 'utf8');
  await fs.rm(paths.runOutcome, { force: true });
  await fs.writeFile(
    paths.runScript,
    buildRunScript({
      readyFile: paths.readyFile,
      signalTrapPackage: signalTrapPackageFile(),
      codeFile: paths.runCode,
      outcomeFile: paths.runOutcome,
      nonce,
    }),
    'utf8',
  );
}

async function logSize(vmLog: string): Promise<number> {
  return (await fs.stat(vmLog).catch(() => undefined))?.size ?? 0;
}

async function awaitOutcome(
  paths: InstancePaths,
  pollIntervalMs: number,
  deadline: number,
  vm: LaunchedVm,
  signal?: AbortSignal,
): Promise<ParsedOutcome | undefined | 'vm_exited' | 'interrupted'> {
  let exited = false;
  void vm.exited.then(() => {
    exited = true;
  });
  for (;;) {
    if (signal?.aborted === true) return 'interrupted';
    const wasExited = exited;
    const text = await fs.readFile(paths.runOutcome, 'utf8').catch(() => '');
    const outcome = parseOutcomeFile(text);
    if (outcome !== undefined) return outcome;
    if (wasExited) return 'vm_exited';
    if (Date.now() >= deadline) return undefined;
    await sleep(pollIntervalMs);
  }
}

/** What happened while waiting for the code to finish. */
type CodeWait =
  | { kind: 'outcome'; outcome: ParsedOutcome }
  | { kind: 'timed_out' }
  | { kind: 'vm_exited' }
  | { kind: 'interrupted' };

/** A RunView plus the not_saved failure of a save that could not save, if any. */
interface RunReport {
  view: RunView;
  notSaved?: CuisctlError;
}

interface PreparedRun {
  paths: InstancePaths;
  nonce: string;
  logOffset: number;
}

type CapturedOutput = Awaited<ReturnType<typeof captureOutput>>;

async function awaitCode(
  paths: InstancePaths,
  pollIntervalMs: number,
  deadline: number,
  vm: LaunchedVm,
  signal?: AbortSignal,
): Promise<CodeWait> {
  let exited = false;
  void vm.exited.then(() => {
    exited = true;
  });
  for (;;) {
    if (signal?.aborted === true) return { kind: 'interrupted' };
    const wasExited = exited;
    const text = await fs.readFile(paths.runOutcome, 'utf8').catch(() => '');
    const outcome = parseOutcomeFile(text);
    if (outcome !== undefined) return { kind: 'outcome', outcome };
    if (wasExited) return { kind: 'vm_exited' };
    if (Date.now() >= deadline) return { kind: 'timed_out' };
    await sleep(pollIntervalMs);
  }
}

async function assertCanRun(opts: RunOptions): Promise<void> {
  if ((await instanceState(opts.home, opts.name)).state !== 'stopped') {
    throw new CuisctlError(
      'instance_running',
      `Instance "${opts.name}" is already running; stop it first`,
      `cuisctl stop ${opts.name}`,
    );
  }
  if (opts.signal?.aborted === true) {
    throw new CuisctlError('interrupted', 'Interrupted before the code ran');
  }
}

async function prepareRun(opts: RunOptions): Promise<PreparedRun> {
  await prepareHome(opts);
  const paths = instancePaths(opts.home, opts.name);
  const nonce = randomBytes(8).toString('hex');
  await writeRunFiles(paths, opts.code, nonce);
  const logOffset = await logSize(paths.vmLog);
  await backupImage(paths);
  return { paths, nonce, logOffset };
}

/** A failed or timed_out view for a run that produced no outcome of its own. */
function abnormalView(
  name: string,
  status: 'failed' | 'timed_out',
  elapsedMs: number,
  captured: CapturedOutput,
  error: string,
): RunView {
  return {
    name,
    status,
    elapsedMs,
    ...captured,
    error,
    resultTruncated: false,
    saved: false,
    detached: false,
  };
}

/** Stops the VM with save; returns the not_saved error when the save was not confirmed. */
async function saveImage(
  opts: RunOptions,
  vm: LaunchedVm,
  saveOnStop: boolean,
  pollIntervalMs: number,
): Promise<CuisctlError | undefined> {
  try {
    await stopWithSave(
      { home: opts.home, name: opts.name, pollIntervalMs },
      { pid: vm.pid, startTime: vm.startTime, saveOnStop },
    );
    return undefined;
  } catch (e) {
    if (!(e instanceof CuisctlError) || e.kind !== 'not_saved') throw e;
    return e;
  }
}

/** Kills and restores unless the image was saved or the VM handed over; always drops temp files. */
async function cleanUp(
  opts: RunOptions,
  paths: InstancePaths,
  vm: LaunchedVm,
  fate: { saved: boolean; handedOver: boolean },
): Promise<void> {
  const discard = !fate.saved && !fate.handedOver;
  if (discard) await killVm(vm);
  if (!fate.handedOver) await removeRunRecord(opts.home, opts.name);
  try {
    if (discard) await restoreImage(paths);
    await fs.rm(paths.runBackup, { recursive: true, force: true });
  } finally {
    await fs.rm(paths.runCode, { force: true });
    await fs.rm(paths.runScript, { force: true });
    await fs.rm(paths.runOutcome, { force: true });
  }
}

async function runOnce(opts: RunOptions): Promise<RunReport> {
  await assertCanRun(opts);
  const { paths, nonce, logOffset } = await prepareRun(opts);
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const headless = opts.headless ?? true;
  const vm = await spawnInstanceVm({
    home: opts.home,
    name: opts.name,
    script: await fs.readFile(paths.runScript, 'utf8'),
    headless,
  });
  const fate = { saved: false, handedOver: false };
  try {
    const ready = await waitForReadiness(vm, {
      startTimeoutMs: opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
      pollIntervalMs,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    if (ready.kind === 'aborted') {
      throw new CuisctlError('interrupted', 'Interrupted before the code ran');
    }
    if (ready.kind !== 'ready') return { view: await failStart(opts.name, vm, ready) };
    const saveOnStop = ready.readyContent.includes('armed=true');
    await writeRunRecord(opts.home, opts.name, {
      pid: vm.pid,
      startTime: vm.startTime,
      mode: headless ? 'headless' : 'gui',
      bridge: false,
      saveOnStop,
      startedAt: new Date().toISOString(),
    });
    const timeoutMs = opts.timeoutMs ?? opts.timeoutSeconds * 1000;
    const codeStart = Date.now();
    const wait = await awaitCode(paths, pollIntervalMs, codeStart + timeoutMs, vm, opts.signal);
    const captured = await captureOutput(paths.vmLog, logOffset, nonce);
    const abnormal = (status: 'failed' | 'timed_out', error: string): RunReport => ({
      view: abnormalView(opts.name, status, Date.now() - codeStart, captured, error),
    });
    if (wait.kind === 'interrupted') return abnormal('failed', 'Interrupted before the code completed');
    if (wait.kind === 'vm_exited') return abnormal('failed', 'VM ended before the code completed');
    if (wait.kind === 'timed_out') {
      return abnormal('timed_out', `The code did not finish within ${timeoutMs / 1000} seconds`);
    }
    const { outcome } = wait;
    let notSaved: CuisctlError | undefined;
    if (outcome.status === 'passed' && opts.save === true) {
      notSaved = await saveImage(opts, vm, saveOnStop, pollIntervalMs);
      fate.saved = notSaved === undefined;
    }
    fate.handedOver = opts.detach === true;
    const view: RunView = {
      name: opts.name,
      status: outcome.status,
      elapsedMs: outcome.elapsedMs,
      ...captured,
      ...(outcome.status === 'failed' ? { error: outcome.error } : { result: outcome.result }),
      resultTruncated: outcome.resultTruncated,
      saved: fate.saved,
      detached: fate.handedOver,
    };
    return notSaved === undefined ? { view } : { view, notSaved };
  } finally {
    await cleanUp(opts, paths, vm, fate);
  }
}

/** Runs the run flow; never rejects, failures are returned as an error Result. */
export async function runRun(opts: RunOptions): Promise<Result> {
  try {
    validateName(opts.name);
    const record = await readInstance(opts.home, opts.name);
    requireCurrentCuisVersion(record, opts.name);
    const { view: data, notSaved } = await withInstanceLock(opts.home, opts.name, () => runOnce(opts));
    if (notSaved !== undefined) {
      const { kind, message, hint } = notSaved;
      return {
        ok: false,
        command: 'run',
        error: hint === undefined ? { kind, message } : { kind, message, hint },
        data,
      };
    }
    if (data.status === 'failed' && opts.signal?.aborted === true) {
      return {
        ok: false,
        command: 'run',
        error: { kind: 'interrupted', message: data.error ?? '' },
        data,
      };
    }
    if (data.status === 'failed') {
      return {
        ok: false,
        command: 'run',
        error: { kind: 'run_failed', message: data.error ?? '' },
        data,
      };
    }
    if (data.status === 'timed_out') {
      return {
        ok: false,
        command: 'run',
        error: { kind: 'run_timed_out', message: data.error ?? '' },
        data,
      };
    }
    return { ok: true, command: 'run', data };
  } catch (e) {
    return errorResult(e);
  }
}
