import { spawn } from 'node:child_process';
import { access, appendFile, mkdir, readdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readInstance } from '../instance.js';
import { spawnVm } from '../launcher.js';
import { cuisBaseDir, cuisKeyDir, instanceLockFile, locksDir } from '../paths.js';
import type { InstancePaths } from '../paths.js';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_KEY } from '../pin.js';
import { pidsHoldingFile, processStartTime } from '../processInfo.js';
import { buildStartScript, signalTrapPackageFile } from '../startScript.js';
import { instanceState } from '../state.js';
import { makeLifecycleHome } from '../testSupport/lifecycleHome.js';
import { snapshotTree } from '../testSupport/snapshotTree.js';
import { runReset } from './reset.js';
import { runStart } from './start.js';
import { stoppedView } from './status.js';
import { runStop } from './stop.js';

describe('cuisctl reset command', () => {
  it('runReset on a stopped instance restores the base image and changes and leaves files untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      await appendFile(paths.image, Buffer.from('user image edits'));
      await appendFile(paths.changes, Buffer.from('user changes edits'));
      await mkdir(join(paths.files, 'nested'), { recursive: true });
      await writeFile(join(paths.files, 'nested', 'notes.txt'), 'keep me');
      await symlink('nested/notes.txt', join(paths.files, 'link-to-notes'));
      const filesBefore = await snapshotTree(paths.files);
      const record = await readInstance(home, 'demo');

      // When
      const result = await runReset({ home, name: 'demo' });

      // Then
      expect(result).toEqual({ ok: true, command: 'reset', data: stoppedView(home, record) });
      const baseDir = cuisBaseDir(home, CUIS_KEY);
      expect((await readFile(paths.image)).equals(await readFile(join(baseDir, CUIS_IMAGE_FILE)))).toBe(true);
      expect((await readFile(paths.changes)).equals(await readFile(join(baseDir, CUIS_CHANGES_FILE)))).toBe(true);
      expect(await snapshotTree(paths.files)).toEqual(filesBefore);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it.each(['tracked', 'untracked'] as const)(
    'runReset on a %s running instance fails instance_running, leaves the image untouched and does not signal the VM',
    async (mode) => {
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
        const result = await runReset({ home, name: 'demo' });

        // Then
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe('instance_running');
        expect(result.error.message).toContain('stop it first');
        expect(result.error.hint).toBe('cuisctl stop demo');
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

  it('runReset on an instance pinned to another Cuis version fails version_mismatch and leaves the image untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      const record = JSON.parse(await readFile(paths.instanceJson, 'utf8'));
      await writeFile(paths.instanceJson, JSON.stringify({ ...record, cuisKey: '7.7-0000000' }, null, 2));
      await appendFile(paths.image, Buffer.from('user image edits'));
      const imageBefore = await readFile(paths.image);

      // When
      const result = await runReset({ home, name: 'demo' });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('version_mismatch');
      expect((await readFile(paths.image)).equals(imageBefore)).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runReset while another process holds the instance lock fails busy at once and leaves the image untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const { home, paths } = lifecycle;
      await appendFile(paths.image, Buffer.from('user image edits'));
      const imageBefore = await readFile(paths.image);
      child = spawn('sleep', ['30']);
      const pid = child.pid as number;
      await mkdir(locksDir(home), { recursive: true });
      await writeFile(instanceLockFile(home, 'demo'), JSON.stringify({ pid, startTime: await processStartTime(pid) }));

      // When
      const t0 = Date.now();
      const result = await runReset({ home, name: 'demo' });
      const elapsed = Date.now() - t0;

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('busy');
      expect(elapsed).toBeLessThan(1000);
      expect((await readFile(paths.image)).equals(imageBefore)).toBe(true);
    } finally {
      child?.kill();
      await lifecycle.cleanup();
    }
  });

  it('runReset with the Cuis home not ready fails home_not_ready, leaves the image untouched and never prepares the home', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      await appendFile(paths.image, Buffer.from('user image edits'));
      const imageBefore = await readFile(paths.image);
      await rm(cuisKeyDir(home, CUIS_KEY), { recursive: true });

      // When
      const result = await runReset({ home, name: 'demo' });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('home_not_ready');
      expect(result.error.hint).toBe('cuisctl start demo');
      expect((await readFile(paths.image)).equals(imageBefore)).toBe(true);
      expect(await access(cuisKeyDir(home, CUIS_KEY)).then(() => true, () => false)).toBe(false);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runReset whose copy fails midway reports the error and leaves the old image, changes and files untouched with no temp leftovers', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home, paths } = lifecycle;
      await mkdir(join(paths.files, 'nested'), { recursive: true });
      await writeFile(join(paths.files, 'nested', 'notes.txt'), 'keep me');
      await appendFile(paths.image, Buffer.from('user image edits'));
      await appendFile(paths.changes, Buffer.from('user changes edits'));
      const imageBefore = await readFile(paths.image);
      const changesBefore = await readFile(paths.changes);
      const filesBefore = await snapshotTree(paths.files);
      const failingCopy = async (src: string, dest: string): Promise<void> => {
        const bytes = await readFile(src);
        await writeFile(dest, bytes.subarray(0, Math.floor(bytes.length / 2)));
        throw new Error('disk full');
      };

      // When
      const result = await runReset({ home, name: 'demo', copy: failingCopy });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.message).toContain('disk full');
      expect((await readFile(paths.image)).equals(imageBefore)).toBe(true);
      expect((await readFile(paths.changes)).equals(changesBefore)).toBe(true);
      expect((await readdir(paths.imageDir)).filter((e) => e.includes('.cuisctl-reset-'))).toEqual([]);
      expect(await snapshotTree(paths.files)).toEqual(filesBefore);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it.each([
    ['image file deleted', (p: InstancePaths) => rm(p.image)],
    ['changes file deleted', (p: InstancePaths) => rm(p.changes)],
    ['whole image folder deleted', (p: InstancePaths) => rm(p.imageDir, { recursive: true })],
    ['image truncated to 10 bytes', (p: InstancePaths) => truncate(p.image, 10)],
    ['sources symlink deleted', (p: InstancePaths) => rm(p.sources)],
  ] as const)(
    'runReset recovers a stopped instance with its %s: base image and changes restored and the instance starts again',
    async (_label, damage) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      try {
        const { home, paths } = lifecycle;
        await damage(paths);

        // When
        const result = await runReset({ home, name: 'demo' });

        // Then
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
        const baseDir = cuisBaseDir(home, CUIS_KEY);
        expect((await readFile(paths.image)).equals(await readFile(join(baseDir, CUIS_IMAGE_FILE)))).toBe(true);
        expect((await readFile(paths.changes)).equals(await readFile(join(baseDir, CUIS_CHANGES_FILE)))).toBe(true);
        const started = await runStart({
          home,
          name: 'demo',
          headless: true,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        });
        expect(started.ok).toBe(true);
        if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
        expect((await instanceState(home, 'demo')).state).toBe('running');
      } finally {
        await runStop({ home: lifecycle.home, name: 'demo' });
        await lifecycle.cleanup();
      }
    },
  );

  it.each([
    ['nope', 'not_found'],
    ['Bad_Name', 'invalid_name'],
  ] as const)('runReset on instance %s fails %s', async (name, kind) => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { home } = lifecycle;

      // When
      const result = await runReset({ home, name });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe(kind);
    } finally {
      await lifecycle.cleanup();
    }
  });
});
