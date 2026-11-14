/**
 * Lock file recording which process owns it.
 *
 * The file holds JSON `{ pid, startTime }`: the owner's pid and its `ps`
 * lstart (see `processStartTime`). A lock is live when that pid is running
 * with the same lstart.
 *
 * Files are created atomically by writing a unique `<file>.<pid>.<uuid>` temp
 * file and hard-linking it to the target, which fails with EEXIST if the
 * target already exists.
 *
 * Taking over a stale lock is serialized through an exclusive
 * `<lockFile>.takeover` marker (same JSON format, plus a random token),
 * created the same atomic way. Without it, two
 * callers could both see the stale lock and the second could remove the
 * first's freshly created lock, so both would win. Holding the marker lets
 * only one caller at a time inspect, remove and recreate the lock.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { processStartTime } from './processInfo.js';

/** Contents of a lock file: the owner's pid and its `ps` lstart. */
interface LockRecord {
  pid: number;
  startTime: string | undefined;
}

/** The `LockRecord` identifying this process as a lock owner. */
async function ownLockRecord(): Promise<LockRecord> {
  return { pid: process.pid, startTime: await processStartTime(process.pid) };
}

/** The JSON `LockRecord` identifying this process as a lock owner. */
async function ownLockContent(): Promise<string> {
  return JSON.stringify(await ownLockRecord());
}

/**
 * Atomically creates `file` holding `content` by hard-linking a unique temp
 * file to it; resolves `false` if `file` already exists. The temp file is
 * always removed.
 */
async function createExclusive(file: string, content: string): Promise<boolean> {
  const temp = `${file}.${process.pid}.${randomUUID()}`;
  await fs.writeFile(temp, content);
  try {
    await fs.link(temp, file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    await fs.unlink(temp);
  }
}

/**
 * While holding the exclusive `<lockFile>.takeover` marker, re-checks that
 * `lockFile` is not live, removes it and recreates it for this process.
 * Resolves `false` if another takeover holds the marker, the lock became live,
 * or the recreate race is lost. A marker that cannot be created and is not
 * live (left by a crashed process) is removed, and this attempt resolves
 * `false`. The marker carries a random token, and afterwards it is removed
 * only if it still holds this caller's token.
 */
async function takeOverStaleLock(lockFile: string): Promise<boolean> {
  const marker = `${lockFile}.takeover`;
  const markerContent = JSON.stringify({ ...(await ownLockRecord()), token: randomUUID() });
  if (!(await createExclusive(marker, markerContent))) {
    if (!(await isLockLive(marker))) await fs.rm(marker, { force: true });
    return false;
  }
  try {
    if (await isLockLive(lockFile)) return false;
    await fs.rm(lockFile, { force: true });
    return await createExclusive(lockFile, await ownLockContent());
  } finally {
    if ((await fs.readFile(marker, 'utf8').catch(() => undefined)) === markerContent) {
      await fs.rm(marker, { force: true });
    }
  }
}

/**
 * Atomically creates `lockFile` with this process's record and resolves
 * `true`. If it exists and is live (see `isLockLive`), resolves `false`,
 * leaving it untouched; if stale, attempts a serialized takeover (see
 * `takeOverStaleLock`), so concurrent callers yield exactly one winner.
 */
export async function acquireLock(lockFile: string): Promise<boolean> {
  if (await createExclusive(lockFile, await ownLockContent())) return true;
  if (await isLockLive(lockFile)) return false;
  return takeOverStaleLock(lockFile);
}

/**
 * Resolves the content of `file`, or `undefined` when it does not exist.
 * Rejects on any other read failure.
 */
async function readFileIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Resolves the `LockRecord` in `lockFile`, or `undefined` when the file does
 * not exist or its content is not valid JSON. Rejects on any other read
 * failure.
 */
async function readLockRecord(lockFile: string): Promise<LockRecord | undefined> {
  const content = await readFileIfExists(lockFile);
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

/**
 * Resolves `false` when `lockFile` does not exist or its content is not valid
 * JSON (a corrupt lock is stale); otherwise `true` only when the recorded pid
 * is running and its start time equals the recorded `startTime` (guards
 * against pid reuse). Rejects on any other read failure.
 */
export async function isLockLive(lockFile: string): Promise<boolean> {
  const record = await readLockRecord(lockFile);
  if (record === undefined) return false;
  const actual = await processStartTime(record.pid);
  return actual !== undefined && actual === record.startTime;
}

/**
 * Removes `lockFile` only when its content is this process's own lock record;
 * a lock owned by another process is left untouched. A missing file is a
 * no-op. Rejects on any other read failure or if the file cannot be removed.
 */
export async function releaseLock(lockFile: string): Promise<void> {
  const content = await readFileIfExists(lockFile);
  if (content === undefined) return;
  if (content === (await ownLockContent())) {
    await fs.unlink(lockFile);
  }
}
