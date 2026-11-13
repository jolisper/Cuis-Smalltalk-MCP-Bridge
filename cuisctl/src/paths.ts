/**
 * Filesystem locations used by cuisctl.
 *
 * Every cuisctl path derives from a single home directory (default `~/.cuisctl`).
 * Paths never depend on the current working directory or environment variables.
 *
 * Layout:
 *   <home>/cuis/<key>/        one Cuis install per pinned layout key (see pin.ts)
 *   <home>/cuis/<key>/dist/   extracted Cuis distribution
 *   <home>/cuis/<key>/base/   base image
 *   <home>/cuis/<key>.lock    lock held by the process preparing the install
 *   <home>/cuis/<key>.error   records the last failed preparation
 *   <home>/cuis/<key>.tmp-<pid>/  in-progress setup, renamed into place when done
 *   <home>/instances/         all instances
 *   <home>/instances/<name>/  one instance
 *     instance.json           instance metadata
 *     image/                  the instance's image and changes files, plus a
 *                             symlink to the base sources file
 *     CoreUpdates             symlink to the Cuis distribution's core updates
 *     Packages/               Cuis packages
 *     files/                  instance files
 *     vm.log                  VM output
 *     run.json                record of the running VM
 *   <home>/tmp/               staging root for `create`, outside instances/
 */
import os from 'node:os';
import path from 'node:path';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_SOURCES_FILE } from './pin.js';

export type HomeOptions = { home?: string };

/** The cuisctl home: `options.home` if given, otherwise `~/.cuisctl`. */
export function resolveHome(options: HomeOptions = {}): string {
  return options.home ?? path.join(os.homedir(), '.cuisctl');
}

/** Directory holding the Cuis install for layout `key`. */
export function cuisKeyDir(home: string, key: string): string {
  return path.join(home, 'cuis', key);
}

/** Directory holding the extracted Cuis distribution for layout `key`. */
export function cuisDistDir(home: string, key: string): string {
  return path.join(cuisKeyDir(home, key), 'dist');
}

/** Directory holding the base image for layout `key`. */
export function cuisBaseDir(home: string, key: string): string {
  return path.join(cuisKeyDir(home, key), 'base');
}

/** Lock file held by the process preparing the Cuis install for layout `key`. */
export function cuisLockFile(home: string, key: string): string {
  return `${cuisKeyDir(home, key)}.lock`;
}

/** File recording the last failed preparation of the Cuis install for layout `key`. */
export function cuisErrorFile(home: string, key: string): string {
  return `${cuisKeyDir(home, key)}.error`;
}

/**
 * In-progress setup directory for layout `key` (suffixed by the preparer's `pid`),
 * renamed into place as the key directory once complete.
 */
export function cuisTmpDir(home: string, key: string, pid: number): string {
  return `${cuisKeyDir(home, key)}.tmp-${pid}`;
}

/** Directory holding all instances. */
export function instancesDir(home: string): string {
  return path.join(home, 'instances');
}

/** Directory holding the instance named `name`. */
export function instanceDir(home: string, name: string): string {
  return path.join(instancesDir(home), name);
}

export type InstancePaths = {
  dir: string;
  instanceJson: string;
  imageDir: string;
  image: string;
  changes: string;
  sources: string;
  coreUpdates: string;
  packages: string;
  files: string;
  vmLog: string;
  runRecord: string;
  startScript: string;
  readyFile: string;
};

/** Every path inside the instance named `name`. */
export function instancePaths(home: string, name: string): InstancePaths {
  const dir = instanceDir(home, name);
  const imageDir = path.join(dir, 'image');
  return {
    dir,
    instanceJson: path.join(dir, 'instance.json'),
    imageDir,
    image: path.join(imageDir, CUIS_IMAGE_FILE),
    changes: path.join(imageDir, CUIS_CHANGES_FILE),
    sources: path.join(imageDir, CUIS_SOURCES_FILE),
    coreUpdates: path.join(dir, 'CoreUpdates'),
    packages: path.join(dir, 'Packages'),
    files: path.join(dir, 'files'),
    vmLog: path.join(dir, 'vm.log'),
    runRecord: path.join(dir, 'run.json'),
    startScript: path.join(dir, 'start.st'),
    readyFile: path.join(dir, 'ready'),
  };
}

/** Directory holding lock files, outside the instances directory. */
export function locksDir(home: string): string {
  return path.join(home, 'locks');
}

/** Lock file for the instance named `name`. */
export function instanceLockFile(home: string, name: string): string {
  return path.join(locksDir(home), `${name}.lock`);
}

/** Lock file for the bridge. */
export function bridgeLockFile(home: string): string {
  return path.join(locksDir(home), 'bridge.lock');
}

/** Staging root for `create`, outside the instances directory. */
export function stagingDir(home: string): string {
  return path.join(home, 'tmp');
}
