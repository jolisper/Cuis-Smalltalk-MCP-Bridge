// Launching a Cuis VM against an image: run-to-completion (headless, with a
// timeout) via runScript, or long-lived detached spawn via spawnVm.
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';

export interface RunScriptOptions {
  vm: string;
  image: string;
  script: string;
  cwd: string;
  timeoutMs: number;
  logFile: string;
}

/**
 * Result of a headless VM run.
 *
 * - `passed`: the VM exited 0 and its output contains the DONE marker; `exitCode` is 0.
 * - `failed`: the VM exited non-zero and its output contains the DONE marker;
 *   `exitCode` is the VM's exit status.
 * - `timeout_or_crash`: anything else; `exitCode` is 124.
 * - `setup_error`: the VM or the image was not found, so nothing was spawned;
 *   `exitCode` is 2 and `output` is `VM not found: <vm>` or
 *   `Image not found: <image>` (the VM is checked first).
 *
 * Otherwise `output` is the full contents of the log file after the run.
 */
export interface RunScriptResult {
  outcome: 'passed' | 'failed' | 'timeout_or_crash' | 'setup_error';
  exitCode: number;
  output: string;
}

const DONE_MARKER = /DONE exitCode=/;
const TIMEOUT_OR_CRASH_EXIT_CODE = 124;
const SETUP_ERROR_EXIT_CODE = 2;

export async function runScript(opts: RunScriptOptions): Promise<RunScriptResult> {
  if (!(await exists(opts.vm))) return setupError(`VM not found: ${opts.vm}`);
  if (!(await exists(opts.image))) return setupError(`Image not found: ${opts.image}`);
  const log = await fs.open(opts.logFile, 'a');
  try {
    const child = spawn(opts.vm, vmArgv(opts.image, opts.script), {
      cwd: opts.cwd,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    const status = await waitWithTimeout(child, opts.timeoutMs);
    const output = await fs.readFile(opts.logFile, 'utf8');
    return classifyRun(status, output);
  } finally {
    await log.close();
  }
}

export interface SpawnVmOptions {
  vm: string;
  image: string;
  script: string;
  cwd: string;
  logFile: string;
  headless?: boolean;
}

/**
 * Spawns a long-lived VM and returns its `pid` without waiting for it.
 *
 * - The child is detached (its own session/process group), so closing the
 *   caller's terminal does not send it SIGHUP.
 * - stdout and stderr are appended to `logFile`; stdin is ignored.
 * - The child is unref'd so cuisctl can exit while the VM keeps running.
 * - `exited` resolves with the exit status (or null if signalled) on close.
 * - `headless` defaults to true; pass false for a GUI launch.
 */
export async function spawnVm(
  opts: SpawnVmOptions,
): Promise<{ pid: number; exited: Promise<number | null> }> {
  const log = await fs.open(opts.logFile, 'a');
  try {
    const child = spawn(opts.vm, vmArgv(opts.image, opts.script, { headless: opts.headless }), {
      cwd: opts.cwd,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    const exited = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });
    child.unref();
    return { pid: child.pid!, exited };
  } finally {
    await log.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function setupError(output: string): RunScriptResult {
  return { outcome: 'setup_error', exitCode: SETUP_ERROR_EXIT_CODE, output };
}

/**
 * Waits for `child` to close and resolves with its exit status. If it has not
 * closed within `ms`, SIGKILLs the child's whole process group (the child is
 * spawned detached, so it leads its own group) and resolves with `null`.
 */
function waitWithTimeout(child: ChildProcess, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
      resolve(null);
    }, ms);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Maps the VM's exit status and log output to a `RunScriptResult`. */
function classifyRun(status: number | null, output: string): RunScriptResult {
  if (status === null || !DONE_MARKER.test(output)) {
    return { outcome: 'timeout_or_crash', exitCode: TIMEOUT_OR_CRASH_EXIT_CODE, output };
  }
  if (status === 0) {
    return { outcome: 'passed', exitCode: 0, output };
  }
  return { outcome: 'failed', exitCode: status, output };
}

/**
 * Builds the VM argument vector: `[-headless] <image> -s <script>` followed by
 * `-ApplePersistenceIgnoreState YES`.
 *
 * - `-headless` is included only when `headless` is true (the default); pass
 *   `{ headless: false }` for a GUI launch.
 * - `-ApplePersistenceIgnoreState YES` is always appended so macOS does not
 *   try to restore saved window state (see headless-pitfalls research).
 * - `-u` and any package-loading options are never passed: cuisctl never
 *   forces a package reload (functional invariant 12).
 */
export function vmArgv(
  image: string,
  script: string,
  { headless = true }: { headless?: boolean } = {},
): string[] {
  return [
    ...(headless ? ['-headless'] : []),
    image,
    '-s',
    script,
    '-ApplePersistenceIgnoreState',
    'YES',
  ];
}
