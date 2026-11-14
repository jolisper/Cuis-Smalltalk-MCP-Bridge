/**
 * Read-only queries about other processes.
 *
 * Nothing in this module ever signals a process; it only observes, via `ps`
 * and `lsof`. `ps` runs in the C locale so its output does not vary with the
 * user's locale.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Runs `ps -o <field>= -p <pid>` in the C locale; resolves `undefined` if `ps`
 * fails (e.g. no such process is running).
 */
async function psField(field: string, pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('ps', ['-o', `${field}=`, '-p', String(pid)], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolves the `ps` lstart of `pid` (C locale), or `undefined` when no such
 * process is running.
 */
export function processStartTime(pid: number): Promise<string | undefined> {
  return psField('lstart', pid);
}

/**
 * Resolves the `ps` command line of `pid` (C locale), or `undefined` when no
 * such process is running.
 */
export function processCommand(pid: number): Promise<string | undefined> {
  return psField('command', pid);
}

/**
 * Resolves the pids of processes holding `path` open, via `lsof -t`, or `[]`
 * when no process holds it. Rejects on any other `lsof` failure.
 */
export async function pidsHoldingFile(path: string): Promise<number[]> {
  try {
    const { stdout } = await execFileP('lsof', ['-t', path]);
    return stdout.trim().split('\n').map(Number);
  } catch (error) {
    const { code, stdout } = error as { code?: unknown; stdout?: string };
    if (code === 1 && stdout === '') return [];
    throw error;
  }
}
