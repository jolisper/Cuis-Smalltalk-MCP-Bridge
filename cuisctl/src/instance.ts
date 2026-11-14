/**
 * Instance lifecycle: create, read, list, reset image, remove.
 *
 * An instance lives at `<home>/instances/<name>/`:
 *   instance.json   the InstanceRecord
 *   image/          copies of the pinned base image and changes, plus a symlink to the base sources
 *   CoreUpdates     symlink to the distribution's CoreUpdates
 *   Packages/       real directories mirroring the distribution's, each file a symlink
 *   files/, vm.log  empty at creation
 * All symlinks are absolute and point into the shared Cuis install under the Cuis home. Packages is
 * a copy-on-write view: saving a package replaces the instance's symlink with a real file.
 *
 * Create protocol: build the whole layout in a private staging directory under `tmp`, then publish
 * it with one atomic rename to `instances/<name>`. A half-built instance is never visible, a
 * concurrent or repeated create fails with `already_exists`, and failures remove the staging
 * directory. Staging entries left by dead processes are removed on the next create.
 *
 * Reset copies the base image and changes to private temps beside them, then renames them into
 * place. Remove renames the instance into a staging entry under `tmp`, then deletes it.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CuisctlError } from './errors.js';
import {
  cuisBaseDir,
  cuisDistDir,
  type InstancePaths,
  instancePaths,
  instancesDir,
  stagingDir,
} from './paths.js';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_KEY, CUIS_SOURCES_FILE } from './pin.js';
import { processStartTime } from './processInfo.js';

export interface InstanceRecord {
  name: string;
  cuisKey: string;
  createdAt: string;
}

/**
 * Creates the instance named `name` from the pinned Cuis install. The layout is built in a
 * private staging directory and published by a single rename, so a half-built instance is
 * never visible; any failure removes the staging directory.
 */
export async function createInstance({ home, name }: { home: string; name: string }): Promise<InstanceRecord> {
  const published = instancePaths(home, name);
  const staging = path.join(stagingDir(home), stagingEntryName(name));
  const record: InstanceRecord = { name, cuisKey: CUIS_KEY, createdAt: new Date().toISOString() };
  await removeDeadStaging(home);
  await mkdir(stagingDir(home), { recursive: true });
  await mkdir(staging);
  try {
    await buildLayout(home, record, rootedAt(published, staging));
    await mkdir(instancesDir(home), { recursive: true });
    await rename(staging, published.dir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      throw alreadyExistsError(name);
    }
    throw error;
  }
  return record;
}

/** The `already_exists` error for instance `name`; single source of its message and hint. */
export function alreadyExistsError(name: string): CuisctlError {
  return new CuisctlError('already_exists', `Instance "${name}" already exists`, `cuisctl status ${name}`);
}

/** Name of a private staging entry: `<name>-<pid>-<uuid>`. Parsed by STAGING_ENTRY below; keep them in sync. */
function stagingEntryName(name: string): string {
  return `${name}-${process.pid}-${randomUUID()}`;
}

const STAGING_ENTRY = /^.+-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Removes staging entries named by `stagingEntryName` whose pid no longer runs; others are left alone. */
async function removeDeadStaging(home: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(stagingDir(home));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const match = STAGING_ENTRY.exec(entry);
    if (!match) continue;
    if ((await processStartTime(Number(match[1]))) === undefined) {
      await rm(path.join(stagingDir(home), entry), { recursive: true, force: true });
    }
  }
}

/**
 * Builds the instance layout at `paths` (whose `dir` must already exist):
 *   instance.json   `record`
 *   image/          copies of the base image and changes, plus a symlink to the base sources
 *   CoreUpdates     symlink to the distribution's CoreUpdates
 *   Packages/       real directories mirroring the distribution's, each file a symlink
 *   files/          empty
 *   vm.log          empty
 */
async function buildLayout(home: string, record: InstanceRecord, paths: InstancePaths): Promise<void> {
  await writeFile(paths.instanceJson, JSON.stringify(record));
  await buildImage(home, paths);
  await linkSharedDist(home, paths);
  await mkdir(paths.files);
  await writeFile(paths.vmLog, '');
}

/** The same instance layout as `paths`, re-rooted at `root`. */
function rootedAt(paths: InstancePaths, root: string): InstancePaths {
  const mapped = { ...paths };
  for (const key of Object.keys(paths) as (keyof InstancePaths)[]) {
    mapped[key] = path.join(root, path.relative(paths.dir, paths[key]));
  }
  return mapped;
}

/** Links the pinned distribution's CoreUpdates and mirrors its Packages into the instance. */
async function linkSharedDist(home: string, paths: InstancePaths): Promise<void> {
  const distDir = cuisDistDir(home, CUIS_KEY);
  await symlink(path.join(distDir, 'CoreUpdates'), paths.coreUpdates);
  await mirrorWithSymlinks(path.join(distDir, 'Packages'), paths.packages);
}

/**
 * Recreates `sourceDir` as real directories under `targetDir`, symlinking each file by absolute path.
 * Per-file links give copy-on-write semantics: saving a package replaces only the instance's
 * symlink with a real file, leaving the shared distribution untouched.
 */
async function mirrorWithSymlinks(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir);
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) await mirrorWithSymlinks(source, target);
    else await symlink(source, target);
  }
}

/** Copies the pinned base image/changes into the instance and links the shared sources file. */
async function buildImage(home: string, paths: InstancePaths): Promise<void> {
  const baseDir = cuisBaseDir(home, CUIS_KEY);
  await mkdir(paths.imageDir);
  await copyFile(path.join(baseDir, CUIS_IMAGE_FILE), paths.image);
  await copyFile(path.join(baseDir, CUIS_CHANGES_FILE), paths.changes);
  await symlink(path.join(baseDir, CUIS_SOURCES_FILE), paths.sources);
}

/**
 * Restores instance `name`'s image and changes to copies of the pinned base image and changes, and
 * re-creates the sources symlink if it is missing or points elsewhere.
 *
 * Invariant: the image is always either the complete old one or the complete fresh one. Copies go
 * to private temps (`resetTempPath`) and are renamed into place only once both succeed; a failed
 * copy removes the temps and leaves the image untouched. Only `image/` is touched: it is created if
 * missing, and reset temps left there by an interrupted reset are removed first. `copy` is injectable
 * for tests and defaults to `copyFile`.
 */
export async function resetImage(
  home: string,
  name: string,
  copy: (src: string, dest: string) => Promise<void> = copyFile,
): Promise<void> {
  const paths = instancePaths(home, name);
  const baseDir = cuisBaseDir(home, CUIS_KEY);
  await mkdir(paths.imageDir, { recursive: true });
  await removeLeftoverResetTemps(paths.imageDir);
  const imageTemp = resetTempPath(paths.image);
  const changesTemp = resetTempPath(paths.changes);
  try {
    await copy(path.join(baseDir, CUIS_IMAGE_FILE), imageTemp);
    await copy(path.join(baseDir, CUIS_CHANGES_FILE), changesTemp);
  } catch (error) {
    await rm(imageTemp, { force: true });
    await rm(changesTemp, { force: true });
    throw error;
  }
  await rename(imageTemp, paths.image);
  await rename(changesTemp, paths.changes);
  await ensureSymlink(path.join(baseDir, CUIS_SOURCES_FILE), paths.sources);
}

/** Marks a reset temp file: `<file>.cuisctl-reset-<pid>`. Leftovers are recognized by this marker. */
const RESET_TEMP_MARKER = '.cuisctl-reset-';

/** Private temp path next to `file` for a reset in progress by this process. */
function resetTempPath(file: string): string {
  return `${file}${RESET_TEMP_MARKER}${process.pid}`;
}

/** Removes reset temps (any entry containing `RESET_TEMP_MARKER`) left in `imageDir` by an interrupted reset. */
async function removeLeftoverResetTemps(imageDir: string): Promise<void> {
  for (const entry of await readdir(imageDir)) {
    if (entry.includes(RESET_TEMP_MARKER)) await rm(path.join(imageDir, entry), { force: true });
  }
}

/** Makes `link` a symlink to `target`, replacing it if it is missing or points elsewhere. */
async function ensureSymlink(target: string, link: string): Promise<void> {
  if ((await readlinkOrUndefined(link)) === target) return;
  await rm(link, { force: true });
  await symlink(target, link);
}

/** The target of symlink `file`, or `undefined` when it is missing or not a symlink. */
async function readlinkOrUndefined(file: string): Promise<string | undefined> {
  try {
    return await readlink(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EINVAL') return undefined;
    throw error;
  }
}

/**
 * Removes instance `name`'s folder. It is first renamed into a private staging entry, freeing the
 * name at once, then deleted; a crash mid-delete leaves only a staging entry that the next create
 * removes. `rm` does not follow symlinks, so the shared Cuis install and any folder an instance
 * symlink points to are never touched.
 */
export async function removeInstance(home: string, name: string): Promise<void> {
  const staging = path.join(stagingDir(home), stagingEntryName(name));
  await mkdir(stagingDir(home), { recursive: true });
  await rename(instancePaths(home, name).dir, staging);
  await rm(staging, { recursive: true, force: true });
}

/**
 * Reads the record of the instance named `name`; read-only. Validates `name` first, and throws
 * `not_found` (with a `cuisctl create` hint) when no such instance exists.
 */
export async function readInstance(home: string, name: string): Promise<InstanceRecord> {
  validateName(name);
  try {
    return JSON.parse(await readFile(instancePaths(home, name).instanceJson, 'utf8')) as InstanceRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CuisctlError('not_found', `No instance named "${name}"`, `cuisctl create ${name}`);
    }
    throw error;
  }
}

/**
 * Read-only. Returns the records of all instances, sorted by name. Entries that are not
 * directories, whose name is not a valid instance name, or that have no `instance.json`, are
 * skipped. Returns `[]` when the `instances/` directory does not exist; other read errors propagate.
 */
export async function listInstances(home: string): Promise<InstanceRecord[]> {
  let entries;
  try {
    entries = await readdir(instancesDir(home), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: InstanceRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !VALID_NAME.test(entry.name)) continue;
    try {
      records.push(await readInstance(home, entry.name));
    } catch (error) {
      if (error instanceof CuisctlError && error.kind === 'not_found') continue;
      throw error;
    }
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

/** Throws `version_mismatch` unless instance `name`'s record was made with the pinned Cuis (`CUIS_KEY`). */
export function requireCurrentCuisVersion(record: InstanceRecord, name: string): void {
  if (record.cuisKey !== CUIS_KEY) {
    throw new CuisctlError(
      'version_mismatch',
      `Instance "${name}" was made with Cuis ${record.cuisKey} but cuisctl manages ${CUIS_KEY}`,
    );
  }
}

const VALID_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Throws `invalid_name` unless `name` is a lowercase letter followed by
 * lowercase letters, digits or hyphens. Pure syntax check: never touches
 * the filesystem.
 */
export function validateName(name: string): void {
  if (VALID_NAME.test(name)) return;
  throw new CuisctlError(
    'invalid_name',
    `Invalid instance name "${name}": use lowercase letters, digits and hyphens, starting with a letter.`,
  );
}
