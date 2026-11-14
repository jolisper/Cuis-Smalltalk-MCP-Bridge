/**
 * cuisctl's own Cuis home: reports its status and prepares it in the foreground.
 *
 * On-disk protocol (under `<home>/cuis/`, see paths.ts):
 *   <key>/          the published install (`dist/` + `base/`); its existence means ready
 *   <key>.lock      held by the single live preparer
 *   <key>.error     JSON `{kind, message}` recorded by the last failed preparation
 *   <key>.tmp-<pid> in-progress build, renamed to `<key>/` once it passes the smoke boot
 *
 * Status precedence: ready > preparing (live lock) > failed (error file) > missing.
 *
 * Preparation runs in the foreground of the calling command, under the lock: it removes
 * leftover tmp dirs and the error file, then downloads, verifies, unzips, builds the base,
 * smoke-boots a scratch copy and publishes. Only the download step touches the network.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CuisctlError, type ErrorKind } from './errors.js';
import { runScript } from './launcher.js';
import { acquireLock, isLockLive, releaseLock } from './lock.js';
import { cuisBaseDir, cuisDistDir, cuisErrorFile, cuisKeyDir, cuisLockFile, cuisTmpDir } from './paths.js';
import {
  CUIS_ARCHIVE_SHA256,
  CUIS_ARCHIVE_TOP_DIR,
  CUIS_ARCHIVE_URL,
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_DIR,
  CUIS_IMAGE_FILE,
  CUIS_KEY,
  CUIS_SOURCES_FILE,
  CUIS_VM_PATH,
} from './pin.js';

const execFileP = promisify(execFile);

/** Unzip executable used when `unzip` is not given in the options. */
const DEFAULT_UNZIP = '/usr/bin/unzip';

/** Entries inside the in-progress directory. */
const ARCHIVE_ENTRY = 'archive.zip';
const EXTRACT_ENTRY = 'extract';
const DIST_ENTRY = 'dist';
const BASE_ENTRY = 'base';
const SMOKE_ENTRY = 'smoke';

/** The image, changes and sources file names that make up a Cuis base. */
const IMAGE_FILES = [CUIS_IMAGE_FILE, CUIS_CHANGES_FILE, CUIS_SOURCES_FILE];

/** Smoke-boot timeout used when `smokeTimeoutMs` is not given in the options. */
const DEFAULT_SMOKE_TIMEOUT_MS = 120000;

/** Status poll interval used when `pollIntervalMs` is not given in the options. */
const DEFAULT_POLL_INTERVAL_MS = 500;

/** Script run against a copy of the base to check that it boots headlessly. */
const SMOKE_SCRIPT =
  "Transcript logToStdout: true. Transcript show: 'DONE exitCode=0'; newLine. Smalltalk quitPrimitive: 0";

export interface HomeSetupOptions {
  home: string;
  archiveUrl?: string;
  archiveSha256?: string;
  unzip?: string;
  smokeTimeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Prepares a missing or failed cuisctl Cuis home in the foreground; a ready home is left as is.
 * `onProgress` is called once, with a message announcing the preparation, before it starts.
 * Preparation runs under the home lock; if another live preparer holds it, this waits until
 * the home is no longer `preparing`, then rejects with the recorded error if it ended `failed`,
 * otherwise returns. The lock is always released.
 */
export async function ensureHome(
  opts: HomeSetupOptions,
  onProgress: (message: string) => void,
): Promise<void> {
  const keyDir = cuisKeyDir(opts.home, CUIS_KEY);
  if ((await homeStatus(opts)).state === 'ready') {
    await checkReadyHome(opts.home);
    return;
  }
  onProgress(`Preparing Cuis ${CUIS_KEY} in ${keyDir} (first use; downloading ~30 MB)…`);
  const lockFile = cuisLockFile(opts.home, CUIS_KEY);
  let acquired: boolean;
  try {
    await mkdir(path.dirname(keyDir), { recursive: true });
    acquired = await acquireLock(lockFile);
  } catch (err) {
    throw toWriteFailure(err);
  }
  if (!acquired) {
    const status = await waitWhilePreparing(opts);
    if (status.state === 'failed') throw new CuisctlError(status.error.kind, status.error.message);
    return;
  }
  try {
    await prepareLocked(opts, keyDir);
  } finally {
    await releaseLock(lockFile);
  }
}

/**
 * Checks that cuisctl's Cuis home is ready without preparing it (unlike `ensureHome`).
 * A ready home is checked for missing parts (`cuis_corrupt`); any other state rejects with
 * `home_not_ready`, naming that state, with the hint `cuisctl start <name>`.
 */
export async function requireReadyHome(home: string, name: string): Promise<void> {
  const { state } = await homeStatus({ home });
  if (state === 'ready') return checkReadyHome(home);
  throw new CuisctlError('home_not_ready', `Cuis home is not ready (${state})`, `cuisctl start ${name}`);
}

/**
 * Throws `cuis_corrupt`, naming the first missing path, if the ready home `home` is missing its
 * VM or any of its base image, changes or sources files.
 */
async function checkReadyHome(home: string): Promise<void> {
  const baseDir = cuisBaseDir(home, CUIS_KEY);
  const required = [
    path.join(cuisDistDir(home, CUIS_KEY), CUIS_VM_PATH),
    ...IMAGE_FILES.map((name) => path.join(baseDir, name)),
  ];
  for (const part of required) {
    if ((await stat(part).catch(() => undefined)) === undefined) {
      throw new CuisctlError(
        'cuis_corrupt',
        `Cuis home is missing ${part}`,
        `delete ${cuisKeyDir(home, CUIS_KEY)} and run the command again`,
      );
    }
  }
}

/**
 * Runs with the home lock held: returns if the home became ready meanwhile; otherwise clears
 * the previous failure record and prepares the home. On failure the error is recorded in the
 * error file and rethrown; the in-progress directory is always removed.
 */
async function prepareLocked(opts: HomeSetupOptions, keyDir: string): Promise<void> {
  if ((await homeStatus(opts)).state === 'ready') return;
  await removeLeftoverTmpDirs(opts.home);
  await rm(cuisErrorFile(opts.home, CUIS_KEY), { force: true });
  const tmp = cuisTmpDir(opts.home, CUIS_KEY, process.pid);
  try {
    await prepare(opts, tmp, keyDir);
  } catch (err) {
    const failure = toWriteFailure(err);
    await recordFailure(opts.home, failure).catch(() => {
      // A failure to record must not mask the original error.
    });
    throw failure;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Removes every `<key>.tmp-*` entry left by earlier crashed preparations; the held home lock
 * guarantees no live preparer owns them.
 */
async function removeLeftoverTmpDirs(home: string): Promise<void> {
  const cuisDir = path.dirname(cuisKeyDir(home, CUIS_KEY));
  const prefix = `${CUIS_KEY}.tmp-`;
  for (const entry of await readdir(cuisDir)) {
    if (entry.startsWith(prefix)) {
      await rm(path.join(cuisDir, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Polls the home status every `pollIntervalMs` until it is no longer `preparing`, and returns
 * that final status.
 */
async function waitWhilePreparing(opts: HomeSetupOptions): Promise<HomeStatus> {
  for (;;) {
    const status = await homeStatus(opts);
    if (status.state !== 'preparing') return status;
    await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
  }
}

/**
 * Builds the home in the in-progress directory `tmp`: downloads the archive, extracts it to
 * `dist`, copies the pristine image files to `base`, smoke-boots a scratch copy of `base` (so
 * `base` and `dist` are never modified), and publishes `tmp` as the key directory.
 */
async function prepare(opts: HomeSetupOptions, tmp: string, keyDir: string): Promise<void> {
  await mkdir(tmp, { recursive: true });
  await fetchArchive(opts, tmp);
  await extractDistribution(opts, tmp);
  await buildBase(tmp);
  await smokeBoot(opts, tmp);
  await publish(tmp, keyDir);
}

/**
 * Boots a scratch copy of the base headlessly with the smoke script; throws
 * `cuis_base_build_failed` unless the run passes. The scratch folder is removed afterwards.
 */
async function smokeBoot(opts: HomeSetupOptions, tmp: string): Promise<void> {
  const smoke = path.join(tmp, SMOKE_ENTRY);
  await copyImageFiles(path.join(tmp, BASE_ENTRY), smoke);
  const script = path.join(smoke, 'smoke.st');
  await writeFile(script, SMOKE_SCRIPT);
  const result = await runScript({
    vm: path.join(tmp, DIST_ENTRY, CUIS_VM_PATH),
    image: path.join(smoke, CUIS_IMAGE_FILE),
    script,
    cwd: smoke,
    timeoutMs: opts.smokeTimeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS,
    logFile: path.join(smoke, 'smoke.log'),
  });
  if (result.outcome !== 'passed') {
    throw new CuisctlError('cuis_base_build_failed', result.output);
  }
  await rm(smoke, { recursive: true, force: true });
}

/** Filesystem error codes reported as `cuis_write_failed`. */
const WRITE_FAILURE_CODES = ['EACCES', 'ENOSPC', 'EROFS', 'ENOENT', 'EPERM', 'ENOTDIR'];

/** Maps filesystem errors to `cuis_write_failed`; other errors pass through unchanged. */
function toWriteFailure(err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (!(err instanceof CuisctlError) && code !== undefined && WRITE_FAILURE_CODES.includes(code)) {
    return new CuisctlError('cuis_write_failed', (err as Error).message);
  }
  return err;
}

/** Records `err` as JSON `{kind, message}` in the error file, written atomically. */
async function recordFailure(home: string, err: unknown): Promise<void> {
  const error =
    err instanceof CuisctlError
      ? { kind: err.kind, message: err.message }
      : { kind: 'internal_error', message: err instanceof Error ? err.message : String(err) };
  const target = cuisErrorFile(home, CUIS_KEY);
  const tempFile = `${target}.tmp-${process.pid}`;
  await writeFile(tempFile, JSON.stringify(error));
  await rename(tempFile, target);
}

/**
 * Downloads the Cuis archive, verifies its SHA-256 against the pinned (or given) checksum,
 * and writes it into `tmp`; throws `cuis_checksum_mismatch` on a mismatch.
 */
async function fetchArchive(opts: HomeSetupOptions, tmp: string): Promise<void> {
  const bytes = await downloadArchive(opts.archiveUrl ?? CUIS_ARCHIVE_URL);
  const expected = opts.archiveSha256 ?? CUIS_ARCHIVE_SHA256;
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new CuisctlError('cuis_checksum_mismatch', `expected ${expected}, got ${actual}`);
  }
  await writeFile(path.join(tmp, ARCHIVE_ENTRY), bytes);
}

/**
 * Downloads `url` fully into memory; throws `cuis_fetch_failed` on a network error, a non-OK
 * HTTP status, a missing body, or a failure while reading the body.
 */
async function downloadArchive(url: string): Promise<Buffer> {
  const fetchFailed = (cause: unknown): CuisctlError =>
    new CuisctlError(
      'cuis_fetch_failed',
      `Could not download ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw fetchFailed(err);
  }
  if (!response.ok) throw fetchFailed(`HTTP status ${response.status}`);
  if (!response.body) throw fetchFailed('response has no body');
  // The body is read fully through its reader on purpose: pausing the body can crash undici.
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
  } catch (err) {
    throw fetchFailed(err);
  }
  return Buffer.concat(chunks);
}

/** Unzips the archive and moves its top-level directory to `tmp/dist`. */
async function extractDistribution(opts: HomeSetupOptions, tmp: string): Promise<void> {
  const extractDir = path.join(tmp, EXTRACT_ENTRY);
  await execFileP(opts.unzip ?? DEFAULT_UNZIP, ['-q', path.join(tmp, ARCHIVE_ENTRY), '-d', extractDir]);
  await rename(path.join(extractDir, CUIS_ARCHIVE_TOP_DIR), path.join(tmp, DIST_ENTRY));
}

/** Copies the pristine image, changes and sources files from `tmp/dist` to `tmp/base`. */
async function buildBase(tmp: string): Promise<void> {
  await copyImageFiles(path.join(tmp, DIST_ENTRY, CUIS_IMAGE_DIR), path.join(tmp, BASE_ENTRY));
}

/** Creates `toDir` and copies the image, changes and sources files from `fromDir` into it. */
async function copyImageFiles(fromDir: string, toDir: string): Promise<void> {
  await mkdir(toDir);
  for (const name of IMAGE_FILES) {
    await copyFile(path.join(fromDir, name), path.join(toDir, name));
  }
}

/** Removes the archive and extraction leftovers, then renames `tmp` to the key directory. */
async function publish(tmp: string, keyDir: string): Promise<void> {
  await rm(path.join(tmp, ARCHIVE_ENTRY), { force: true });
  await rm(path.join(tmp, EXTRACT_ENTRY), { recursive: true, force: true });
  await rename(tmp, keyDir);
}

/** The error recorded in the error file by a failed preparation. */
type RecordedFailure = { kind: ErrorKind; message: string };

export type HomeStatus = { state: 'missing' } | { state: 'ready' } | { state: 'preparing' }
  | { state: 'failed'; error: RecordedFailure };

/**
 * Status of cuisctl's Cuis home, by precedence:
 *   ready     — the install dir for CUIS_KEY exists
 *   preparing — a live lock is held by a setup in progress
 *   failed    — a recorded error file exists (JSON `{kind, message}`)
 *   missing   — none of the above
 */
export async function homeStatus(opts: HomeSetupOptions): Promise<HomeStatus> {
  const info = await stat(cuisKeyDir(opts.home, CUIS_KEY)).catch(() => undefined);
  if (info?.isDirectory()) {
    return { state: 'ready' };
  }
  if (await isLockLive(cuisLockFile(opts.home, CUIS_KEY))) {
    return { state: 'preparing' };
  }
  const error = await readRecordedFailure(opts.home);
  if (error !== undefined) {
    return { state: 'failed', error };
  }
  return { state: 'missing' };
}

/** Reads the error file `{kind, message}` left by a failed setup; undefined if absent. */
async function readRecordedFailure(home: string): Promise<RecordedFailure | undefined> {
  const recorded = await readFile(cuisErrorFile(home, CUIS_KEY), 'utf8').catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    },
  );
  if (recorded === undefined) return undefined;
  const { kind, message } = JSON.parse(recorded) as RecordedFailure;
  return { kind, message };
}
