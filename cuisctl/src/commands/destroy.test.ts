import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnVm } from '../launcher.js';
import { instanceDir, instanceLockFile, locksDir, stagingDir } from '../paths.js';
import { pidsHoldingFile, processStartTime } from '../processInfo.js';
import { buildStartScript, signalTrapPackageFile } from '../startScript.js';
import { instanceState } from '../state.js';
import { makeLifecycleHome } from '../testSupport/lifecycleHome.js';
import { snapshotTree } from '../testSupport/snapshotTree.js';
import { runCreate } from './create.js';
import { runDestroy } from './destroy.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import type { StatusList } from './status.js';

describe('cuisctl destroy command', () => {
  it('runDestroy --yes on a stopped instance removes its folder, status no longer knows it and the name can be created again', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;

      // When
      const result = await runDestroy({ home, name: 'demo', yes: true });

      // Then
      expect(result).toEqual({
        ok: true,
        command: 'destroy',
        data: { name: 'demo', removed: { instance: paths.dir, files: paths.files } },
      });
      expect(await access(paths.dir).then(() => true, () => false)).toBe(false);
      const named = await runStatus({ home, name: 'demo' });
      expect(named.ok).toBe(false);
      if (named.ok) throw new Error('expected failure');
      expect(named.error.kind).toBe('not_found');
      const listing = await runStatus({ home });
      if (!listing.ok) throw new Error(`status failed: ${listing.error.message}`);
      expect((listing.data as StatusList).instances.map((i) => i.name)).not.toContain('demo');
      const recreated = await runCreate({ home, name: 'demo', onProgress: () => {} });
      expect(recreated.ok).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runDestroy without --yes refuses with confirmation_required naming the folders and leaves the home untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      const before = await snapshotTree(home);

      // When
      const result = await runDestroy({ home, name: 'demo' });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('confirmation_required');
      expect(result.error.message).toContain(paths.dir);
      expect(result.error.message).toContain(paths.files);
      expect(result.error.hint).toBe('cuisctl destroy demo --yes');
      expect(await snapshotTree(home)).toEqual(before);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it.each([
    ['tracked', true],
    ['tracked', false],
    ['untracked', true],
    ['untracked', false],
  ] as const)(
    'runDestroy on a %s running instance with yes=%s fails instance_running before any confirmation, leaves the instance in place and does not signal the VM',
    async (mode, yes) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      let pid: number | undefined;
      try {
        const { home, paths, vm } = lifecycle;
        if (mode === 'tracked') {
          const started = await runStart({
            home,
            name: 'demo',
            headless: true,
            onProgress: () => {},
            startTimeoutMs: 10000,
            pollIntervalMs: 50,
          });
          if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
        } else {
          await writeFile(
            paths.startScript,
            buildStartScript({ readyFile: paths.readyFile, signalTrapPackage: signalTrapPackageFile() }),
          );
          const spawned = await spawnVm({
            vm,
            image: paths.image,
            script: paths.startScript,
            cwd: paths.files,
            logFile: paths.vmLog,
            headless: true,
          });
          for (let i = 0; i < 200; i++) {
            const ready = await access(paths.readyFile).then(() => true, () => false);
            if (ready && (await pidsHoldingFile(paths.changes)).includes(spawned.pid)) break;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        const state = await instanceState(home, 'demo');
        expect(state.state).toBe(mode === 'tracked' ? 'running' : 'running_untracked');
        if (state.state === 'stopped') throw new Error('expected a running instance');
        pid = state.pid;
        const imageBefore = await readFile(paths.image);

        // When
        const result = await runDestroy({ home, name: 'demo', yes });

        // Then
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe('instance_running');
        expect(result.error.message).toBe('Instance "demo" is running; stop it first');
        expect(result.error.hint).toBe('cuisctl stop demo');
        expect(await access(paths.dir).then(() => true, () => false)).toBe(true);
        expect((await readFile(paths.image)).equals(imageBefore)).toBe(true);
        expect(() => process.kill(pid as number, 0)).not.toThrow();
      } finally {
        if (pid !== undefined) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
        await lifecycle.cleanup();
      }
    },
  );

  it('runDestroy --yes while another process holds the instance lock fails busy at once and leaves the instance in place', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const { home, paths } = lifecycle;
      child = spawn('sleep', ['30']);
      const pid = child.pid as number;
      await mkdir(locksDir(home), { recursive: true });
      await writeFile(instanceLockFile(home, 'demo'), JSON.stringify({ pid, startTime: await processStartTime(pid) }));

      // When
      const t0 = Date.now();
      const result = await runDestroy({ home, name: 'demo', yes: true });
      const elapsed = Date.now() - t0;

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('busy');
      expect(elapsed).toBeLessThan(1000);
      expect(await access(paths.dir).then(() => true, () => false)).toBe(true);
    } finally {
      child?.kill();
      await lifecycle.cleanup();
    }
  });

  it('runDestroy --yes removes nothing outside the instance folder (shared cuis, other instances, home files, symlink targets) and create sweeps dead staging entries', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-destroy-outside-'));
    try {
      const { home, paths } = lifecycle;
      const other = await runCreate({ home, name: 'other', onProgress: () => {} });
      if (!other.ok) throw new Error(`create other failed: ${other.error.message}`);
      const canary = path.join(home, 'canary.txt');
      await writeFile(canary, 'canary bytes');
      await writeFile(path.join(outside, 'keep.txt'), 'outside bytes');
      await symlink(outside, path.join(paths.files, 'link'));
      const cuisBefore = await snapshotTree(path.join(home, 'cuis'));
      const otherBefore = await snapshotTree(instanceDir(home, 'other'));
      const outsideBefore = await snapshotTree(outside);
      const canaryBefore = await readFile(canary);

      // When
      const result = await runDestroy({ home, name: 'demo', yes: true });

      // Then
      expect(result.ok).toBe(true);
      expect(await snapshotTree(path.join(home, 'cuis'))).toEqual(cuisBefore);
      expect(await snapshotTree(instanceDir(home, 'other'))).toEqual(otherBefore);
      expect(await snapshotTree(outside)).toEqual(outsideBefore);
      expect((await readFile(canary)).equals(canaryBefore)).toBe(true);
      expect(await readdir(stagingDir(home))).toEqual([]);

      // Given (dead staging entry)
      const deadStaging = path.join(stagingDir(home), 'demo-999999-3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b');
      await mkdir(deadStaging, { recursive: true });
      await writeFile(path.join(deadStaging, 'leftover.txt'), 'leftover');

      // When
      const recreated = await runCreate({ home, name: 'demo', onProgress: () => {} });

      // Then
      expect(recreated.ok).toBe(true);
      expect(await access(deadStaging).then(() => true, () => false)).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
      await lifecycle.cleanup();
    }
  });

  const noSetup = async (): Promise<void> => {};
  const mismatchVersion = async (paths: { instanceJson: string }): Promise<void> => {
    const record = JSON.parse(await readFile(paths.instanceJson, 'utf8'));
    await writeFile(paths.instanceJson, JSON.stringify({ ...record, cuisKey: '7.7-0000000' }));
  };

  it.each([
    { label: 'missing instance without --yes', name: 'nope', yes: false, setup: noSetup, expected: 'not_found' },
    { label: 'missing instance with --yes', name: 'nope', yes: true, setup: noSetup, expected: 'not_found' },
    { label: 'invalid name with --yes', name: 'Bad_Name', yes: true, setup: noSetup, expected: 'invalid_name' },
    { label: 'version-mismatched instance with --yes', name: 'demo', yes: true, setup: mismatchVersion, expected: 'removed' },
  ] as const)('runDestroy on a $label yields $expected', async ({ name, yes, setup, expected }) => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      await setup(paths);

      // When
      const result = await runDestroy({ home, name, yes });

      // Then
      if (expected === 'removed') {
        expect(result.ok).toBe(true);
        expect(await access(paths.dir).then(() => true, () => false)).toBe(false);
      } else {
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe(expected);
      }
    } finally {
      await lifecycle.cleanup();
    }
  });
});
