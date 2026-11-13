/**
 * The cuisctl `start` command.
 *
 * Flow:
 *  1. Validate the name, read the instance record and check its Cuis version.
 *  2. Under the per-instance lock, decide by the instance state: already running as requested
 *     (no-op), running otherwise (instance_running), or stopped (proceed).
 *  3. ensureHome.
 *  4. With --bridge: take the bridge lock, check the port is free (naming the holder) and the
 *     bridge package exists. The bridge lock is held until the start finishes.
 *  5. Launch: drop the stale run record and ready file, write start.st, spawn the VM.
 *  6. Wait for readiness: ready file, bridge handshake, loopback-only check, child exit, timeout.
 *  7. On failure kill the VM (unless it already exited) and report start_failed with the vm.log
 *     tail; on success write the run record and report the running InstanceView.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { definedOnly } from '../definedOnly.js';
import { CuisctlError } from '../errors.js';
import { ensureHome } from '../home.js';
import { listInstances, readInstance, requireCurrentCuisVersion, validateName } from '../instance.js';
import type { InstanceRecord } from '../instance.js';
import { spawnVm } from '../launcher.js';
import type { Result } from '../output.js';
import { CUIS_KEY, CUIS_VM_PATH } from '../pin.js';
import { acquireLock, releaseLock } from '../lock.js';
import { bridgeLockFile, cuisDistDir, instancePaths, locksDir } from '../paths.js';
import { bridgeAnswers, listenerPids, listensOnLoopbackOnly, portInUse } from '../portCheck.js';
import { processStartTime } from '../processInfo.js';
import { signalVm, waitForExit } from '../processControl.js';
import { instanceState } from '../state.js';
import { removeRunRecord, writeRunRecord } from '../runRecord.js';
import { bridgePackageFile, buildStartScript, signalTrapPackageFile } from '../startScript.js';
import { errorResult } from './errorResult.js';
import { withInstanceLock } from './instanceLock.js';
import { instanceView } from './status.js';
import type { InstanceView } from './status.js';

const BRIDGE_PORT = 6789;
const DEFAULT_START_TIMEOUT_MS = 60000;
const BRIDGE_LOCK_POLL_MS = 200;
const BRIDGE_HANDSHAKE_TIMEOUT_MS = 1000;
const KILL_WAIT_MS = 5000;
const KILL_POLL_MS = 50;
const LOG_TAIL_LINES = 20;

export type StartView = InstanceView & { alreadyRunning: boolean };

export interface StartOptions {
  home: string;
  name: string;
  headless?: boolean;
  bridge?: boolean;
  onProgress: (message: string) => void;
  port?: number;
  startTimeoutMs?: number;
  pollIntervalMs?: number;
  archiveUrl?: string;
  archiveSha256?: string;
  unzip?: string;
  smokeTimeoutMs?: number;
}

type InstancePaths = ReturnType<typeof instancePaths>;

interface LaunchedVm {
  pid: number;
  startTime: string;
  exited: Promise<number | null>;
  paths: InstancePaths;
}

type ReadinessOutcome =
  | { kind: 'ready'; readyContent: string }
  | { kind: 'not_loopback_only' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'timeout' };

async function logTail(vmLog: string): Promise<string> {
  const log = await fs.readFile(vmLog, 'utf8').catch(() => '');
  return log.split('\n').slice(-LOG_TAIL_LINES).join('\n');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requestedMode(opts: StartOptions): 'headless' | 'gui' {
  return (opts.headless ?? false) ? 'headless' : 'gui';
}

/** Returns the no-op view when the instance already runs as requested; throws if running otherwise. */
async function alreadyRunningView(opts: StartOptions, record: InstanceRecord): Promise<StartView | undefined> {
  const state = await instanceState(opts.home, opts.name);
  if (
    state.state === 'running' &&
    state.mode === requestedMode(opts) &&
    state.bridge === (opts.bridge ?? false)
  ) {
    return { ...(await instanceView(opts.home, record)), alreadyRunning: true };
  }
  if (state.state !== 'stopped') {
    const described =
      state.state === 'running'
        ? `as ${state.mode}, bridge ${state.bridge ? 'on' : 'off'}`
        : 'untracked';
    throw new CuisctlError(
      'instance_running',
      `Instance "${opts.name}" is already running (${described}); stop it first`,
      `cuisctl stop ${opts.name}`,
    );
  }
  return undefined;
}

async function prepareHome(opts: StartOptions): Promise<void> {
  const { archiveUrl, archiveSha256, unzip, smokeTimeoutMs } = opts;
  const setup = definedOnly({ archiveUrl, archiveSha256, unzip, smokeTimeoutMs });
  await ensureHome({ home: opts.home, ...setup }, opts.onProgress);
}

async function acquireBridgeLock(opts: StartOptions, bridgeLock: string): Promise<void> {
  await fs.mkdir(locksDir(opts.home), { recursive: true });
  const lockDeadline = Date.now() + (opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);
  while (!(await acquireLock(bridgeLock))) {
    if (Date.now() >= lockDeadline) {
      throw new CuisctlError('busy', 'another start --bridge is in progress');
    }
    await sleep(BRIDGE_LOCK_POLL_MS);
  }
}

async function requirePortFree(opts: StartOptions, port: number): Promise<void> {
  if (!(await portInUse(port))) return;
  const pids = await listenerPids(port);
  for (const { name } of await listInstances(opts.home)) {
    const other = await instanceState(opts.home, name);
    if (other.state === 'running' && pids.includes(other.pid)) {
      throw new CuisctlError('port_in_use', `Port ${port} is already in use by instance "${name}"`);
    }
  }
  throw new CuisctlError('port_in_use', `Port ${port} is already in use`);
}

async function requireBridgePackage(): Promise<void> {
  await fs.access(bridgePackageFile()).catch(() => {
    throw new CuisctlError('start_failed', `Bridge package not found: ${bridgePackageFile()}`);
  });
}

async function launchVm(opts: StartOptions, bridgePort: number): Promise<LaunchedVm> {
  await removeRunRecord(opts.home, opts.name);
  const paths = instancePaths(opts.home, opts.name);
  await fs.rm(paths.readyFile, { force: true });
  await fs.writeFile(
    paths.startScript,
    buildStartScript({
      readyFile: paths.readyFile,
      signalTrapPackage: signalTrapPackageFile(),
      ...(opts.bridge ? { bridge: { packageFile: bridgePackageFile(), port: bridgePort } } : {}),
    }),
    'utf8',
  );
  const { pid, exited } = await spawnVm({
    vm: path.join(cuisDistDir(opts.home, CUIS_KEY), CUIS_VM_PATH),
    image: paths.image,
    script: paths.startScript,
    cwd: paths.files,
    logFile: paths.vmLog,
    headless: opts.headless ?? false,
  });
  const startTime = (await processStartTime(pid)) ?? '';
  return { pid, startTime, exited, paths };
}

async function waitForReadiness(
  opts: StartOptions,
  bridgePort: number,
  { pid, exited, paths }: LaunchedVm,
): Promise<ReadinessOutcome> {
  const pollMs = opts.pollIntervalMs ?? 100;
  const deadline = Date.now() + (opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS);
  let exitCode: number | null | undefined;
  void exited.then((code) => {
    exitCode = code;
  });
  for (;;) {
    try {
      const readyContent = await fs.readFile(paths.readyFile, 'utf8');
      if (opts.bridge && !(await bridgeAnswers(bridgePort, BRIDGE_HANDSHAKE_TIMEOUT_MS))) {
        throw new Error('bridge not answering');
      }
      if (opts.bridge && !(await listensOnLoopbackOnly(pid, bridgePort))) {
        return { kind: 'not_loopback_only' };
      }
      return { kind: 'ready', readyContent };
    } catch {
      if (exitCode !== undefined) return { kind: 'exited', code: exitCode };
      if (Date.now() >= deadline) return { kind: 'timeout' };
      await sleep(pollMs);
    }
  }
}

async function killVm({ pid, startTime }: LaunchedVm): Promise<void> {
  await signalVm(pid, startTime, 'SIGKILL');
  await waitForExit(pid, startTime, KILL_WAIT_MS, KILL_POLL_MS);
}

/** Turns a non-ready outcome into a start_failed error, killing the VM if it is still running. */
async function failStart(
  opts: StartOptions,
  vm: LaunchedVm,
  outcome: Exclude<ReadinessOutcome, { kind: 'ready' }>,
): Promise<never> {
  const subject = `Instance "${opts.name}"`;
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

async function startStoppedInstance(opts: StartOptions, record: InstanceRecord): Promise<StartView> {
  await prepareHome(opts);
  const bridgeLock = bridgeLockFile(opts.home);
  let holdsBridgeLock = false;
  try {
    const bridgePort = opts.port ?? BRIDGE_PORT;
    if (opts.bridge) {
      await acquireBridgeLock(opts, bridgeLock);
      holdsBridgeLock = true;
      await requirePortFree(opts, bridgePort);
      await requireBridgePackage();
    }
    const vm = await launchVm(opts, bridgePort);
    const outcome = await waitForReadiness(opts, bridgePort, vm);
    if (outcome.kind !== 'ready') return await failStart(opts, vm, outcome);
    await writeRunRecord(opts.home, opts.name, {
      pid: vm.pid,
      startTime: vm.startTime,
      mode: requestedMode(opts),
      bridge: opts.bridge ?? false,
      saveOnStop: outcome.readyContent.includes('armed=true'),
      startedAt: new Date().toISOString(),
    });
    return { ...(await instanceView(opts.home, record)), alreadyRunning: false };
  } finally {
    if (holdsBridgeLock) await releaseLock(bridgeLock);
  }
}

/** Runs the start flow; never rejects, failures are returned as an error Result. */
export async function runStart(opts: StartOptions): Promise<Result> {
  try {
    validateName(opts.name);
    const record = await readInstance(opts.home, opts.name);
    requireCurrentCuisVersion(record, opts.name);
    const data = await withInstanceLock(
      opts.home,
      opts.name,
      async () => (await alreadyRunningView(opts, record)) ?? (await startStoppedInstance(opts, record)),
    );
    return { ok: true, command: 'start', data };
  } catch (e) {
    return errorResult(e);
  }
}
