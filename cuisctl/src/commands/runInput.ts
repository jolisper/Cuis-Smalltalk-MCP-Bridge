/**
 * Run input resolution: turns the `run` command options into the Smalltalk code to execute and its timeout.
 */

import { CuisctlError } from '../errors.js';

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 300;

export interface RunInputOptions {
  code?: string;
  file?: string;
  stdin?: boolean;
  timeout?: string;
  save?: boolean;
  detach?: boolean;
  headless?: boolean;
  gui?: boolean;
}

export interface RunInputDeps {
  readStdin: () => Promise<{ text: string; isTTY: boolean }>;
  readFile: (path: string) => Promise<string>;
}

function usageError(message: string): CuisctlError {
  return new CuisctlError('usage', message);
}

/** Rejects mutually exclusive options and more than one code source. Performs no I/O. */
function rejectConflicts(opts: RunInputOptions): void {
  if (opts.save && opts.detach) {
    throw usageError('--save and --detach are mutually exclusive');
  }
  if (opts.headless && opts.gui) {
    throw usageError('--headless and --gui are mutually exclusive');
  }
  const sourceCount = [opts.code !== undefined, opts.file !== undefined, opts.stdin === true].filter(Boolean).length;
  if (sourceCount > 1) {
    throw usageError('Give only one of: <code>, --file <path> or --stdin');
  }
}

async function readFileSource(path: string, readFile: RunInputDeps['readFile']): Promise<string> {
  try {
    return await readFile(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw usageError(`Cannot read file ${path}: ${reason}`);
  }
}

async function readStdinSource(readStdin: RunInputDeps['readStdin']): Promise<string> {
  const stdin = await readStdin();
  if (stdin.isTTY) {
    throw usageError('--stdin needs piped input, but stdin is a terminal');
  }
  return stdin.text;
}

/** Reads the code from the single chosen source: --file, --stdin or the inline argument. */
async function readSource(opts: RunInputOptions, deps: RunInputDeps): Promise<string> {
  if (opts.file !== undefined) return readFileSource(opts.file, deps.readFile);
  if (opts.stdin) return readStdinSource(deps.readStdin);
  if (opts.code === undefined) {
    throw usageError('Give the code to run: <code>, --file <path> or --stdin');
  }
  return opts.code;
}

function parseTimeout(timeout: string | undefined): number {
  if (timeout === undefined) return DEFAULT_TIMEOUT_SECONDS;
  if (!/^[1-9]\d*$/.test(timeout) || Number(timeout) > MAX_TIMEOUT_SECONDS) {
    throw usageError(`--timeout must be a whole number of seconds from 1 to ${MAX_TIMEOUT_SECONDS}`);
  }
  return Number(timeout);
}

/**
 * Resolves the `run` options into the code to execute and its timeout.
 *
 * Rules, applied in this order (the first violation throws a `usage` CuisctlError):
 *  1. Option conflicts: --save/--detach, --headless/--gui, and more than one of
 *     <code>/--file/--stdin. All checked before any read, so nothing is consumed on a bad invocation.
 *  2. Read the code from its source. stdin is only read after the shape checks above;
 *     an unreadable file or a TTY stdin is rejected; no source at all is rejected.
 *  3. The code must not be blank.
 *  4. --timeout, if given, must be a whole number of seconds from 1 to MAX_TIMEOUT_SECONDS;
 *     otherwise DEFAULT_TIMEOUT_SECONDS applies.
 */
export async function resolveRunInput(
  opts: RunInputOptions,
  deps: RunInputDeps,
): Promise<{ code: string; timeoutSeconds: number }> {
  rejectConflicts(opts);
  const code = await readSource(opts, deps);
  if (code.trim() === '') {
    throw usageError('The code to run is empty');
  }
  return { code, timeoutSeconds: parseTimeout(opts.timeout) };
}
