import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnVm } from '../launcher.js';
import { instanceLockFile, locksDir } from '../paths.js';
import { pidsHoldingFile, processStartTime } from '../processInfo.js';
import { buildStartScript, signalTrapPackageFile } from '../startScript.js';
import { instanceState } from '../state.js';
import { writeFakeVmConfig } from '../testSupport/fakeVm.js';
import { makeLifecycleHome } from '../testSupport/lifecycleHome.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import { runStop } from './stop.js';

describe('cuisctl stop command', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('runStop for a missing instance resolves not_found without creating anything', async () => {
    // Given
    const opts = { home, name: 'nope' };

    // When
    const result = await runStop(opts);

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('not_found');
    expect(await readdir(home)).toEqual([]);
  });

  it('runStop without save kills the VM, removes the run record and leaves the image untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.command).toBe('stop');
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: false });
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      expect((await readFile(lifecycle.paths.image)).equals(imageBefore)).toBe(true);
      await expect(access(join(lifecycle.paths.imageDir, 'signals.log'))).rejects.toThrow();
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop with save asks the VM to save and quit via SIGTERM and reports saved', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name, save: true });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.command).toBe('stop');
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: true });
      const imageAfter = await readFile(lifecycle.paths.image);
      expect(imageAfter.equals(imageBefore)).toBe(false);
      expect(imageAfter.subarray(0, imageBefore.length).equals(imageBefore)).toBe(true);
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      expect(await readFile(join(lifecycle.paths.imageDir, 'signals.log'), 'utf8')).toContain('SIGTERM');
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop with save when save on stop is unavailable skips SIGTERM, kills the VM and fails not_saved', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { armed: false });
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name, save: true });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('not_saved');
      expect(result.error.message).toContain('stopped, not saved');
      expect(result.error.message).toContain('save on stop unavailable');
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      expect((await readFile(lifecycle.paths.image)).equals(imageBefore)).toBe(true);
      await expect(access(join(lifecycle.paths.imageDir, 'signals.log'))).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop with save never hangs: a VM ignoring SIGTERM is SIGKILLed after the save timeout and fails not_saved', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { onTerm: 'ignore' });
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const t0 = Date.now();
      const result = await runStop({
        home: lifecycle.home,
        name: lifecycle.name,
        save: true,
        saveTimeoutMs: 1000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - t0;

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('not_saved');
      expect(result.error.message).toContain('stopped, not saved');
      expect(result.error.message).toContain('did not save within');
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(8000);
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      expect((await readFile(lifecycle.paths.image)).equals(imageBefore)).toBe(true);
      expect(await readFile(join(lifecycle.paths.imageDir, 'signals.log'), 'utf8')).toContain('SIGTERM');
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStop with save keeps waiting past the save timeout while the image is still changing, up to the hard cap', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { onTerm: 'slowSave', slowSaveMs: 2500 });
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const t0 = Date.now();
      const result = await runStop({
        home: lifecycle.home,
        name: lifecycle.name,
        save: true,
        saveTimeoutMs: 1000,
        hardCapMs: 15000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - t0;

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: true });
      expect(elapsed).toBeGreaterThanOrEqual(2000);
      expect(await readFile(join(lifecycle.paths.imageDir, 'signals.log'), 'utf8')).toContain('SIGTERM');
      const imageAfter = await readFile(lifecycle.paths.image);
      expect(imageAfter.length).toBeGreaterThan(imageBefore.length);
      expect(imageAfter.subarray(0, imageBefore.length).equals(imageBefore)).toBe(true);
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runStop stops an instance running untracked (no run record, a Squeak process holds the changes file)', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { paths, vm } = lifecycle;
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
      expect((await instanceState(lifecycle.home, lifecycle.name)).state).toBe('running_untracked');

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: false });
      expect(await pidsHoldingFile(paths.changes)).toEqual([]);
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop with save on an untracked armed instance sends SIGTERM and reports saved', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const { paths, vm } = lifecycle;
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
      expect((await instanceState(lifecycle.home, lifecycle.name)).state).toBe('running_untracked');
      const imageBefore = await readFile(paths.image);

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name, save: true });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: true });
      const imageAfter = await readFile(paths.image);
      expect(imageAfter.length).toBeGreaterThan(imageBefore.length);
      expect(imageAfter.subarray(0, imageBefore.length).equals(imageBefore)).toBe(true);
      expect(await readFile(join(paths.imageDir, 'signals.log'), 'utf8')).toContain('SIGTERM');
      expect(await pidsHoldingFile(paths.changes)).toEqual([]);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop refuses to touch a non-Squeak process holding the instance files (with and without save)', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const fd = openSync(lifecycle.paths.changes, 'r');
    const child = spawn('sh', ['-c', 'exec sleep 30'], { stdio: [fd, 'ignore', 'ignore'] });
    closeSync(fd);
    const pid = child.pid as number;
    try {
      for (let i = 0; i < 200; i++) {
        if ((await pidsHoldingFile(lifecycle.paths.changes)).includes(pid)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toContain(pid);
      expect(await pidsHoldingFile(lifecycle.paths.changes)).not.toContain(process.pid);
      expect((await instanceState(lifecycle.home, lifecycle.name)).state).toBe('running_untracked');

      // When
      const plain = await runStop({ home: lifecycle.home, name: lifecycle.name });
      const withSave = await runStop({ home: lifecycle.home, name: lifecycle.name, save: true });

      // Then
      for (const result of [plain, withSave]) {
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe('instance_running');
        expect(result.error.message).toContain(String(pid));
        expect(result.error.message).toContain('not a Squeak VM');
      }
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(child.signalCode).toBeNull();
      expect(child.exitCode).toBeNull();
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toContain(pid);
    } finally {
      child.kill('SIGKILL');
      await lifecycle.cleanup();
    }
  });

  it('runStop on a stopped instance with a stale run record is a no-op that clears the record', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(
        lifecycle.paths.runRecord,
        JSON.stringify({
          pid: 999999,
          startTime: 'Mon Jan  1 00:00:00 2001',
          mode: 'gui',
          bridge: false,
          saveOnStop: true,
          startedAt: new Date().toISOString(),
        }),
      );

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.command).toBe('stop');
      expect(result.data).toEqual({ name: 'demo', outcome: 'already_stopped', saved: false });
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      await expect(access(lifecycle.invocationLog)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStop while another process holds the instance lock resolves busy at once without signalling the VM and leaves status unblocked', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const before = await instanceState(lifecycle.home, lifecycle.name);
      expect(before.state).toBe('running');
      child = spawn('sleep', ['30']);
      const pid = child.pid as number;
      await mkdir(locksDir(lifecycle.home), { recursive: true });
      await writeFile(
        instanceLockFile(lifecycle.home, lifecycle.name),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When
      const t0 = Date.now();
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });
      const elapsed = Date.now() - t0;
      const after = await instanceState(lifecycle.home, lifecycle.name);
      const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('busy');
      expect(elapsed).toBeLessThan(1000);
      expect(after).toEqual(before);
      expect(status.ok).toBe(true);
      if (!status.ok) throw new Error(`expected success: ${status.error.message}`);
      expect(status.data).toMatchObject({ state: 'running' });
    } finally {
      child?.kill();
      await lifecycle.cleanup();
    }
  });

  it('runStop and status work when instance.json records a cuisKey that is not installed', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);
      const record = JSON.parse(await readFile(lifecycle.paths.instanceJson, 'utf8'));
      await writeFile(lifecycle.paths.instanceJson, JSON.stringify({ ...record, cuisKey: '7.7-0000000' }));

      // When
      const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });
      const stopped = await runStop({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(status.ok).toBe(true);
      if (!status.ok) throw new Error(`expected success: ${status.error.message}`);
      expect(status.data).toMatchObject({ cuisKey: '7.7-0000000', state: 'running' });
      expect(stopped.ok).toBe(true);
      if (!stopped.ok) throw new Error(`expected success: ${stopped.error.message}`);
      expect(stopped.data).toMatchObject({ outcome: 'stopped' });
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('start and stop (plain and with save) leave the files directory untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const snapshot = async () => {
      const entries = (await readdir(lifecycle.paths.files, { recursive: true })).sort();
      const out: Record<string, { mtimeMs: number; content: string | null }> = {};
      for (const rel of entries) {
        const full = join(lifecycle.paths.files, rel);
        const s = await stat(full);
        out[rel] = { mtimeMs: s.mtimeMs, content: s.isFile() ? await readFile(full, 'utf8') : null };
      }
      return out;
    };
    const start = () =>
      runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
    try {
      await mkdir(join(lifecycle.paths.files, 'UserChanges'), { recursive: true });
      await writeFile(join(lifecycle.paths.files, 'UserChanges', 'demo.user.changes'), 'user changes');
      await writeFile(join(lifecycle.paths.files, 'notes.txt'), 'some notes');
      const before = await snapshot();

      // When
      const first = await start();
      if (!first.ok) throw new Error(`start failed: ${first.error.message}`);
      const plain = await runStop({ home: lifecycle.home, name: lifecycle.name });
      const second = await start();
      if (!second.ok) throw new Error(`start failed: ${second.error.message}`);
      const saved = await runStop({ home: lifecycle.home, name: lifecycle.name, save: true });

      // Then
      expect(plain.ok).toBe(true);
      expect(saved.ok).toBe(true);
      expect(await snapshot()).toEqual(before);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runStop treats a run record with a live pid but a forged start time as stale and does not kill the process', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const child = spawn('sleep', ['30']);
    try {
      await writeFile(
        lifecycle.paths.runRecord,
        JSON.stringify({
          pid: child.pid,
          startTime: 'Mon Jan  1 00:00:00 2001',
          mode: 'gui',
          bridge: false,
          saveOnStop: true,
          startedAt: new Date().toISOString(),
        }),
      );

      // When
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toEqual({ name: 'demo', outcome: 'already_stopped', saved: false });
      expect(() => process.kill(child.pid as number, 0)).not.toThrow();
      expect(child.signalCode).toBeNull();
      expect(child.exitCode).toBeNull();
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      child.kill('SIGKILL');
      await lifecycle.cleanup();
    }
  });

  it('plain runStop returns promptly for a VM that ignores SIGTERM', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { onTerm: 'ignore' });
      const started = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      if (!started.ok) throw new Error(`start failed: ${started.error.message}`);

      // When
      const t0 = Date.now();
      const result = await runStop({ home: lifecycle.home, name: lifecycle.name });
      const elapsed = Date.now() - t0;

      // Then
      expect(elapsed).toBeLessThan(3000);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toEqual({ name: 'demo', outcome: 'stopped', saved: false });
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
    } finally {
      await lifecycle.cleanup();
    }
  });
});
