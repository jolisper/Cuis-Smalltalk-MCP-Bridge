/**
 * Run record: `instances/<name>/run.json`, describing a running instance.
 * Fields: pid, startTime (process start time, to detect pid reuse), mode,
 * bridge (bridge enabled), saveOnStop, startedAt (ISO timestamp).
 * `start` writes it atomically (temp file + rename); `stop` removes it.
 */
import { promises as fs } from 'node:fs';
import { instancePaths } from './paths.js';

export interface RunRecord {
  pid: number;
  startTime: string;
  mode: 'gui' | 'headless';
  bridge: boolean;
  saveOnStop: boolean;
  startedAt: string;
}

export async function writeRunRecord(home: string, name: string, record: RunRecord): Promise<void> {
  const target = instancePaths(home, name).runRecord;
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(record), 'utf8');
  await fs.rename(temp, target);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Removes the run record; a no-op when there is none. */
export async function removeRunRecord(home: string, name: string): Promise<void> {
  try {
    await fs.unlink(instancePaths(home, name).runRecord);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

/** The instance's run record, or undefined when it has none. Never writes. */
export async function readRunRecord(home: string, name: string): Promise<RunRecord | undefined> {
  try {
    return JSON.parse(await fs.readFile(instancePaths(home, name).runRecord, 'utf8')) as RunRecord;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}
