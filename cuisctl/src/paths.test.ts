import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bridgeLockFile,
  cuisBaseDir,
  cuisDistDir,
  cuisErrorFile,
  cuisKeyDir,
  cuisLockFile,
  cuisTmpDir,
  instanceDir,
  instanceLockFile,
  instancePaths,
  instancesDir,
  locksDir,
  resolveHome,
  stagingDir,
} from './paths.js';

describe('cuisctl paths', () => {
  it('resolves home to ~/.cuisctl when no options are given', () => {
    // Given
    const expected = path.join(os.homedir(), '.cuisctl');

    // When
    const home = resolveHome();

    // Then
    expect(home).toBe(expected);
  });

  it('resolves home to the given home option when provided', () => {
    // Given
    const options = { home: '/tmp/cuisctl-test-home' };

    // When
    const home = resolveHome(options);

    // Then
    expect(home).toBe('/tmp/cuisctl-test-home');
  });

  it('derives the Cuis key directory under home/cuis/<key>', () => {
    // Given
    const home = '/h';
    const key = '7.8-d4f9cc1';

    // When
    const dir = cuisKeyDir(home, key);

    // Then
    expect(dir).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1'));
  });

  it('derives the dist and base directories under the Cuis key directory', () => {
    // Given
    const home = '/h';
    const key = '7.8-d4f9cc1';

    // When
    const dist = cuisDistDir(home, key);
    const base = cuisBaseDir(home, key);

    // Then
    expect(dist).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1', 'dist'));
    expect(base).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1', 'base'));
  });

  it('derives the lock, error, and tmp sibling paths of the Cuis key directory', () => {
    // Given
    const home = '/h';
    const key = '7.8-d4f9cc1';

    // When
    const lock = cuisLockFile(home, key);
    const error = cuisErrorFile(home, key);
    const tmp = cuisTmpDir(home, key, 42);

    // Then
    expect(lock).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1.lock'));
    expect(error).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1.error'));
    expect(tmp).toBe(path.join('/h', 'cuis', '7.8-d4f9cc1.tmp-42'));
  });

  it('derives the instances directory and a named instance directory under home/instances', () => {
    // Given
    const home = '/h';
    const name = 'demo';

    // When
    const instances = instancesDir(home);
    const instance = instanceDir(home, name);

    // Then
    expect(instances).toBe(path.join('/h', 'instances'));
    expect(instance).toBe(path.join('/h', 'instances', 'demo'));
  });

  it('derives the staging directory under home/tmp, outside instances', () => {
    // Given
    const home = '/h';

    // When
    const staging = stagingDir(home);

    // Then
    expect(staging).toBe(path.join('/h', 'tmp'));
  });

  it('derives every path inside a named instance directory', () => {
    // Given
    const home = '/h';
    const name = 'demo';
    const d = path.join('/h', 'instances', 'demo');

    // When
    const paths = instancePaths(home, name);

    // Then
    expect(paths).toEqual({
      dir: d,
      instanceJson: path.join(d, 'instance.json'),
      imageDir: path.join(d, 'image'),
      image: path.join(d, 'image', 'Cuis7.8.image'),
      changes: path.join(d, 'image', 'Cuis7.8.changes'),
      sources: path.join(d, 'image', 'Cuis7.8.sources'),
      coreUpdates: path.join(d, 'CoreUpdates'),
      packages: path.join(d, 'Packages'),
      files: path.join(d, 'files'),
      vmLog: path.join(d, 'vm.log'),
      runRecord: path.join(d, 'run.json'),
      startScript: path.join(d, 'start.st'),
      readyFile: path.join(d, 'ready'),
    });
  });

  it('derives lock paths under <home>/locks, outside instances', () => {
    expect(locksDir('/h')).toBe(path.join('/h', 'locks'));
    expect(instanceLockFile('/h', 'demo')).toBe(path.join('/h', 'locks', 'demo.lock'));
    expect(bridgeLockFile('/h')).toBe(path.join('/h', 'locks', 'bridge.lock'));
  });
});
