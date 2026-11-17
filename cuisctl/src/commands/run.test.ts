import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exitCode } from '../output.js';
import { homeStatus } from '../home.js';
import { cuisKeyDir } from '../paths.js';
import { CUIS_KEY } from '../pin.js';
import { instanceState } from '../state.js';
import { startArchiveServer } from '../testSupport/archiveServer.js';
import { buildFakeArchive } from '../testSupport/fakeDistribution.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { writeFakeVmConfig } from '../testSupport/fakeVm.js';
import { makeLifecycleHome } from '../testSupport/lifecycleHome.js';
import { withInstanceLock } from './instanceLock.js';
import { runRun } from './run.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import { runStop } from './stop.js';

describe('cuisctl run command', () => {
  it('runRun on a stopped instance boots it, runs the code, returns a passed RunView and leaves the instance stopped without a run record', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', elapsedMs: 12 });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.command).toBe('run');
      expect(result.data).toMatchObject({
        name: lifecycle.name,
        status: 'passed',
        result: '7',
        elapsedMs: 12,
        output: expect.stringContaining('3 + 4'),
        outputTruncated: false,
        saved: false,
        detached: false,
      });
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun restores the image and changes files byte-for-byte after a run that saved the image, and removes the backup and run files', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      const originalChanges = await readFile(lifecycle.paths.changes);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'saveImage' });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      expect(await readFile(lifecycle.paths.changes)).toEqual(originalChanges);
      await expect(access(lifecycle.paths.runBackup)).rejects.toThrow();
      await expect(access(lifecycle.paths.runCode)).rejects.toThrow();
      await expect(access(lifecycle.paths.runScript)).rejects.toThrow();
      await expect(access(lifecycle.paths.runOutcome)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun returns a run_failed error with exit code 1 and a failed RunView when the code fails, restores the image and leaves the instance stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'failed', error: 'ZeroDivide', elapsedMs: 3 });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '1/0',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      expect(result.command).toBe('run');
      expect(result.error).toMatchObject({ kind: 'run_failed', message: expect.stringContaining('ZeroDivide') });
      expect(result.data).toMatchObject({
        name: lifecycle.name,
        status: 'failed',
        error: 'ZeroDivide',
        elapsedMs: 3,
        saved: false,
        detached: false,
        output: expect.stringContaining('1/0'),
      });
      expect((result.data as { result?: string }).result).toBeUndefined();
      expect(exitCode(result)).toBe(1);
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun returns a run_timed_out error with the captured output when the code hangs past its deadline, kills the VM and restores the image', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'hang' });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '[true] whileTrue',
        timeoutSeconds: 60,
        timeoutMs: 500,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      expect(result.command).toBe('run');
      expect(result.error).toMatchObject({ kind: 'run_timed_out' });
      expect(result.data).toMatchObject({
        name: lifecycle.name,
        status: 'timed_out',
        saved: false,
        detached: false,
        output: expect.stringContaining('some output before hanging'),
      });
      const data = result.data as { elapsedMs: number; result?: string };
      expect(Number.isInteger(data.elapsedMs)).toBe(true);
      expect(data.elapsedMs).toBeGreaterThanOrEqual(400);
      expect(data.elapsedMs).toBeLessThan(5000);
      expect(data.result).toBeUndefined();
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 12000);

  it('runRun returns a run_failed error promptly when the VM exits without an outcome, restores the image and leaves the instance stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'quit' });

      // When
      const startedAt = Date.now();
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: 'Smalltalk quit',
        timeoutSeconds: 60,
        timeoutMs: 30000,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      const wallMs = Date.now() - startedAt;

      // Then
      expect(wallMs).toBeLessThan(10000);
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ kind: 'run_failed' });
      expect(result.data).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('VM ended before the code completed'),
        saved: false,
        detached: false,
      });
      const data = result.data as { elapsedMs: number; result?: string };
      expect(data.result).toBeUndefined();
      expect(Number.isInteger(data.elapsedMs)).toBe(true);
      expect(data.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it('runRun bounds a 10 MB output flood to a 64 KiB head+tail excerpt, reports outputTruncated and outputBytes, and still derives the passed status from the outcome file', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'flood', floodBytes: 10_000_000, result: '7' });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: 'flood',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toMatchObject({ status: 'passed', outputTruncated: true, result: '7' });
      const data = result.data as { output: string; outputBytes: number };
      expect(data.outputBytes).toBeGreaterThanOrEqual(10_000_000);
      expect(data.outputBytes).toBeLessThanOrEqual(10_100_000);
      expect(data.output.length).toBe(65536);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun on a running instance fails with instance_running hinting cuisctl stop and leaves the VM, the image files and the instance directory untouched', async () => {
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
      if (!started.ok) throw new Error(`expected success: ${started.error.message}`);
      const before = await instanceState(lifecycle.home, lifecycle.name);
      if (before.state !== 'running') throw new Error(`expected running, got ${before.state}`);
      const pid = before.pid;
      const imageBefore = await readFile(lifecycle.paths.image);
      const changesBefore = await readFile(lifecycle.paths.changes);
      const listingBefore = (await readdir(lifecycle.paths.dir)).sort();

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('instance_running');
      expect(result.error.hint).toBe(`cuisctl stop ${lifecycle.name}`);
      expect(() => process.kill(pid, 0)).not.toThrow();
      const after = await instanceState(lifecycle.home, lifecycle.name);
      expect(after.state).toBe('running');
      expect(after.state === 'running' && after.pid).toBe(pid);
      await access(lifecycle.paths.runRecord);
      expect(await readFile(lifecycle.paths.image)).toEqual(imageBefore);
      expect(await readFile(lifecycle.paths.changes)).toEqual(changesBefore);
      const listingAfter = (await readdir(lifecycle.paths.dir)).sort();
      expect(listingAfter).toEqual(listingBefore);
      for (const p of [
        lifecycle.paths.runCode,
        lifecycle.paths.runScript,
        lifecycle.paths.runOutcome,
        lifecycle.paths.runBackup,
      ]) {
        await expect(access(p)).rejects.toThrow();
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun returns start_failed without a run status when the VM never becomes ready, restores the image, removes run files and leaves the instance stopped without executing the code', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      const imageBefore = await readFile(lifecycle.paths.image);
      const changesBefore = await readFile(lifecycle.paths.changes);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'neverReady' });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 1000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('start_failed');
      expect(result.error.message).toMatch(/timed out|timeout/i);
      expect(result.data).toBeUndefined();
      expect(await readFile(lifecycle.paths.image)).toEqual(imageBefore);
      expect(await readFile(lifecycle.paths.changes)).toEqual(changesBefore);
      for (const p of [
        lifecycle.paths.runBackup,
        lifecycle.paths.runCode,
        lifecycle.paths.runScript,
        lifecycle.paths.runOutcome,
        lifecycle.paths.runRecord,
      ]) {
        await expect(access(p)).rejects.toThrow();
      }
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      const vmLog = await readFile(lifecycle.paths.vmLog, 'utf8').catch(() => '');
      expect(vmLog).not.toContain('BEGIN');
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it('runRun with save on a save-armed VM saves via SIGTERM instead of restoring the image, stops the instance and removes run files', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      await writeFakeVmConfig(lifecycle.paths.imageDir, {
        run: 'passed',
        result: '7',
        onTerm: 'save',
        armed: true,
      });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        save: true,
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.data).toMatchObject({ status: 'passed', saved: true, detached: false });
      expect((await readFile(lifecycle.paths.image)).toString()).toBe('ORIGINAL-IMAGE-BYTES\nsaved\n');
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      for (const p of [
        lifecycle.paths.runRecord,
        lifecycle.paths.runBackup,
        lifecycle.paths.runCode,
        lifecycle.paths.runScript,
        lifecycle.paths.runOutcome,
      ]) {
        await expect(access(p)).rejects.toThrow();
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it.each([
    {
      label: 'run_failed when the code fails',
      fake: { run: 'failed', error: 'ZeroDivide', onTerm: 'save', armed: true } as const,
      timeoutMs: undefined,
      kind: 'run_failed',
    },
    {
      label: 'run_timed_out when the code hangs',
      fake: { run: 'hang', onTerm: 'save', armed: true } as const,
      timeoutMs: 500,
      kind: 'run_timed_out',
    },
  ])(
    'runRun with save on a save-armed VM does not save when the run ends as $label: the VM is killed, the image files stay original, the instance stops and run files are removed',
    async ({ fake, timeoutMs, kind }) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      try {
        await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
        await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
        const originalImage = await readFile(lifecycle.paths.image);
        const originalChanges = await readFile(lifecycle.paths.changes);
        await writeFakeVmConfig(lifecycle.paths.imageDir, { ...fake });

        // When
        const result = await runRun({
          home: lifecycle.home,
          name: lifecycle.name,
          code: '1/0',
          save: true,
          timeoutSeconds: 60,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          headless: true,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        });

        // Then
        expect(result.ok).toBe(false);
        expect(result.error).toMatchObject({ kind });
        expect(result.data).toMatchObject({ saved: false, detached: false });
        expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
        expect(await readFile(lifecycle.paths.changes)).toEqual(originalChanges);
        expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
        for (const p of [
          lifecycle.paths.runRecord,
          lifecycle.paths.runBackup,
          lifecycle.paths.runCode,
          lifecycle.paths.runScript,
          lifecycle.paths.runOutcome,
        ]) {
          await expect(access(p)).rejects.toThrow();
        }
      } finally {
        await lifecycle.cleanup();
      }
    },
    30000,
  );

  it('runRun with save on a VM without save-on-stop returns not_saved with the passed RunView, stops the instance, leaves the image files original and removes run files', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      const originalChanges = await readFile(lifecycle.paths.changes);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', armed: false });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        save: true,
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      expect(result.command).toBe('run');
      expect(result.error).toMatchObject({ kind: 'not_saved' });
      expect(exitCode(result)).toBe(1);
      expect(result.data).toMatchObject({ status: 'passed', result: '7', saved: false, detached: false });
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      expect(await readFile(lifecycle.paths.changes)).toEqual(originalChanges);
      for (const p of [
        lifecycle.paths.runRecord,
        lifecycle.paths.runBackup,
        lifecycle.paths.runCode,
        lifecycle.paths.runScript,
        lifecycle.paths.runOutcome,
      ]) {
        await expect(access(p)).rejects.toThrow();
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun with detach on a mutating VM leaves it running with the mutated image files, removes run files and releases the lock', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      const originalChanges = await readFile(lifecycle.paths.changes);
      await writeFakeVmConfig(lifecycle.paths.imageDir, {
        run: 'mutate',
        result: '7',
        onTerm: 'save',
        armed: true,
      });

      // When
      const result = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        detach: true,
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      try {
        // Then
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
        expect(result.data).toMatchObject({ status: 'passed', saved: false, detached: true });
        const state = await instanceState(lifecycle.home, lifecycle.name);
        expect(state).toMatchObject({ state: 'running', mode: 'headless', bridge: false });
        if (state.state !== 'running') throw new Error(`expected running, got ${state.state}`);
        expect(() => process.kill(state.pid, 0)).not.toThrow();
        await access(lifecycle.paths.runRecord);
        expect(await readFile(lifecycle.paths.image)).toEqual(Buffer.concat([originalImage, Buffer.from('MUTATED')]));
        expect(await readFile(lifecycle.paths.changes)).toEqual(
          Buffer.concat([originalChanges, Buffer.from('MUTATED')]),
        );
        for (const p of [
          lifecycle.paths.runBackup,
          lifecycle.paths.runCode,
          lifecycle.paths.runScript,
          lifecycle.paths.runOutcome,
        ]) {
          await expect(access(p)).rejects.toThrow();
        }
        const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });
        expect(status.ok).toBe(true);
        const stopped = await runStop({ home: lifecycle.home, name: lifecycle.name, save: false });
        expect(stopped.ok).toBe(true);
        expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      } finally {
        await runStop({ home: lifecycle.home, name: lifecycle.name, save: false }).catch(() => {});
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it.each([
    {
      label: 'run_timed_out when the code hangs',
      fake: { run: 'hang' } as const,
      timeoutMs: 500,
      kind: 'run_timed_out',
    },
    {
      label: 'run_failed when the VM exits without an outcome',
      fake: { run: 'quit' } as const,
      timeoutMs: undefined,
      kind: 'run_failed',
    },
  ])(
    'runRun with detach does not hand the VM over when the run ends as $label: nothing is detached or saved, the image files are restored, the instance stops and run files are removed',
    async ({ fake, timeoutMs, kind }) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      try {
        await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
        await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
        const originalImage = await readFile(lifecycle.paths.image);
        const originalChanges = await readFile(lifecycle.paths.changes);
        await writeFakeVmConfig(lifecycle.paths.imageDir, { ...fake });

        // When
        const result = await runRun({
          home: lifecycle.home,
          name: lifecycle.name,
          code: '1/0',
          detach: true,
          timeoutSeconds: 60,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          headless: true,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        });

        // Then
        expect(result.ok).toBe(false);
        expect(result.error).toMatchObject({ kind });
        expect(result.data).toMatchObject({ saved: false, detached: false });
        expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
        expect(await readFile(lifecycle.paths.changes)).toEqual(originalChanges);
        expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
        for (const p of [
          lifecycle.paths.runRecord,
          lifecycle.paths.runBackup,
          lifecycle.paths.runCode,
          lifecycle.paths.runScript,
          lifecycle.paths.runOutcome,
        ]) {
          await expect(access(p)).rejects.toThrow();
        }
      } finally {
        await lifecycle.cleanup();
      }
    },
    30000,
  );

  it.each([
    { label: 'headless: false launches the VM in GUI mode', headless: false, mode: 'gui' },
    { label: 'headless omitted launches the VM headless by default', headless: undefined, mode: 'headless' },
  ])(
    'runRun with detach and $label: the VM invocation and the instance mode agree',
    async ({ headless, mode }) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      try {
        await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed' });

        // When
        const result = await runRun({
          home: lifecycle.home,
          name: lifecycle.name,
          code: '3 + 4',
          detach: true,
          timeoutSeconds: 60,
          ...(headless !== undefined ? { headless } : {}),
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        } as Parameters<typeof runRun>[0]);

        try {
          // Then
          expect(result.ok).toBe(true);
          const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
          expect(lines).toHaveLength(1);
          if (mode === 'gui') expect(lines[0]).not.toContain('-headless');
          else expect(lines[0]).toContain('-headless');
          expect(await instanceState(lifecycle.home, lifecycle.name)).toMatchObject({ state: 'running', mode });
        } finally {
          await runStop({ home: lifecycle.home, name: lifecycle.name, save: false }).catch(() => {});
        }
      } finally {
        await lifecycle.cleanup();
      }
    },
    30000,
  );

  it('a detached instance follows the start rules: same mode without bridge is a no-op alreadyRunning, another mode or --bridge fails instance_running, and a further run is refused', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed' });
      const kept = await runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '3 + 4',
        detach: true,
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      try {
        expect(kept.ok).toBe(true);
        const before = await instanceState(lifecycle.home, lifecycle.name);
        if (before.state !== 'running') throw new Error(`expected running, got ${before.state}`);
        const startOpts = {
          home: lifecycle.home,
          name: lifecycle.name,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        };

        // When
        const sameMode = await runStart({ ...startOpts, headless: true });
        const otherMode = await runStart({ ...startOpts, headless: false });
        const withBridge = await runStart({ ...startOpts, headless: true, bridge: true });
        const furtherRun = await runRun({
          home: lifecycle.home,
          name: lifecycle.name,
          code: '3 + 4',
          timeoutSeconds: 60,
          headless: true,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        });

        // Then
        expect(sameMode.ok).toBe(true);
        if (!sameMode.ok) throw new Error(`expected success: ${sameMode.error.message}`);
        expect(sameMode.data).toMatchObject({ alreadyRunning: true, pid: before.pid });
        expect(otherMode.ok).toBe(false);
        expect(otherMode.error).toMatchObject({ kind: 'instance_running' });
        expect(withBridge.ok).toBe(false);
        expect(withBridge.error).toMatchObject({ kind: 'instance_running' });
        expect(furtherRun.ok).toBe(false);
        expect(furtherRun.error).toMatchObject({ kind: 'instance_running' });
        const after = await instanceState(lifecycle.home, lifecycle.name);
        expect(after.state === 'running' && after.pid).toBe(before.pid);
      } finally {
        await runStop({ home: lifecycle.home, name: lifecycle.name, save: false }).catch(() => {});
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runRun fails fast with busy while the instance lock is held,creating no run files or backup, leaving the image files untouched, and status still succeeds', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
      const imageBefore = await readFile(lifecycle.paths.image);
      const changesBefore = await readFile(lifecycle.paths.changes);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const holder = withInstanceLock(lifecycle.home, lifecycle.name, async () => {
        entered();
        await gate;
      });
      try {
        await lockHeld;

        // When
        const startedAt = Date.now();
        const result = await runRun({
          home: lifecycle.home,
          name: lifecycle.name,
          code: '3 + 4',
          timeoutSeconds: 60,
          headless: true,
          onProgress: () => {},
          startTimeoutMs: 10000,
          pollIntervalMs: 50,
        });
        const wallMs = Date.now() - startedAt;
        const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });

        // Then
        expect(wallMs).toBeLessThan(2000);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe('busy');
        for (const p of [
          lifecycle.paths.runCode,
          lifecycle.paths.runScript,
          lifecycle.paths.runOutcome,
          lifecycle.paths.runBackup,
          lifecycle.paths.runRecord,
        ]) {
          await expect(access(p)).rejects.toThrow();
        }
        expect(await readFile(lifecycle.paths.image)).toEqual(imageBefore);
        expect(await readFile(lifecycle.paths.changes)).toEqual(changesBefore);
        expect(status.ok).toBe(true);
      } finally {
        release();
        await holder;
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it('runRun returns an interrupted error promptly when its signal aborts mid-run, kills the VM, restores the image, removes run files and releases the lock', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
      const originalImage = await readFile(lifecycle.paths.image);
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'hang' });
      const controller = new AbortController();

      // When
      const pending = runRun({
        home: lifecycle.home,
        name: lifecycle.name,
        code: '[true] whileTrue',
        timeoutSeconds: 60,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
        signal: controller.signal,
      });
      const pollDeadline = Date.now() + 5000;
      while (Date.now() < pollDeadline) {
        const log = await readFile(lifecycle.paths.vmLog, 'utf8').catch(() => '');
        const recorded = await access(lifecycle.paths.runRecord).then(
          () => true,
          () => false,
        );
        if (log.includes('BEGIN') && recorded) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      controller.abort();
      const result = await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('runRun did not resolve within 5s of abort')), 5000),
        ),
      ]);

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('interrupted');
      expect(result.data).toMatchObject({
        status: 'failed',
        detached: false,
        saved: false,
        output: expect.stringContaining('some output before hanging'),
      });
      const data = result.data as { error?: string };
      expect(typeof data.error).toBe('string');
      expect(data.error).not.toBe('');
      expect(data.error).toMatch(/interrupt/i);
      expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      for (const p of [
        lifecycle.paths.runRecord,
        lifecycle.paths.runBackup,
        lifecycle.paths.runCode,
        lifecycle.paths.runScript,
        lifecycle.paths.runOutcome,
      ]) {
        await expect(access(p)).rejects.toThrow();
      }
      const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });
      expect(status.ok).toBe(true);
      let acquired = false;
      await withInstanceLock(lifecycle.home, lifecycle.name, async () => {
        acquired = true;
      });
      expect(acquired).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it.each([
    {
      label: 'aborts while the VM is still booting',
      fake: { run: 'neverReady' } as const,
      abortAfterMs: 500,
      expectSpawned: true,
    },
    {
      label: 'is already aborted before the call',
      fake: { run: 'passed' } as const,
      abortAfterMs: undefined,
      expectSpawned: false,
    },
  ])(
    'runRun returns an interrupted error promptly when its signal $label: restores the image, stops the instance, removes run files and releases the lock',
    async ({ fake, abortAfterMs, expectSpawned }) => {
      // Given
      const lifecycle = await makeLifecycleHome();
      try {
        await writeFile(lifecycle.paths.image, 'ORIGINAL-IMAGE-BYTES\n');
        await writeFile(lifecycle.paths.changes, 'ORIGINAL-CHANGES-BYTES\n');
        const originalImage = await readFile(lifecycle.paths.image);
        const originalChanges = await readFile(lifecycle.paths.changes);
        await writeFakeVmConfig(lifecycle.paths.imageDir, { ...fake });
        const controller = new AbortController();
        if (abortAfterMs === undefined) controller.abort();
        else setTimeout(() => controller.abort(), abortAfterMs);

        // When
        const result = await Promise.race([
          runRun({
            home: lifecycle.home,
            name: lifecycle.name,
            code: '3 + 4',
            timeoutSeconds: 60,
            headless: true,
            onProgress: () => {},
            startTimeoutMs: 30000,
            pollIntervalMs: 50,
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('runRun did not resolve within 5s of abort')), 5000 + (abortAfterMs ?? 0)),
          ),
        ]);

        // Then
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('expected failure');
        expect(result.error.kind).toBe('interrupted');
        if (!expectSpawned) {
          const vmLog = await readFile(lifecycle.paths.vmLog, 'utf8').catch(() => '');
          expect(vmLog).toBe('');
        }
        expect(await readFile(lifecycle.paths.image)).toEqual(originalImage);
        expect(await readFile(lifecycle.paths.changes)).toEqual(originalChanges);
        expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
        for (const p of [
          lifecycle.paths.runRecord,
          lifecycle.paths.runBackup,
          lifecycle.paths.runCode,
          lifecycle.paths.runScript,
          lifecycle.paths.runOutcome,
        ]) {
          await expect(access(p)).rejects.toThrow();
        }
        let acquired = false;
        await withInstanceLock(lifecycle.home, lifecycle.name, async () => {
          acquired = true;
        });
        expect(acquired).toBe(true);
      } finally {
        await lifecycle.cleanup();
      }
    },
    15000,
  );
});

describe('cuisctl run command: errors shared with the existing commands', () => {
  const baseOpts = { code: '3 + 4', timeoutSeconds: 60, headless: true, onProgress: () => {} };

  it.each([
    { label: 'an invalid name', name: 'Bad_Name', kind: 'invalid_name', record: undefined, hint: undefined },
    { label: 'an absent name', name: 'ghost', kind: 'not_found', record: undefined, hint: 'cuisctl create ghost' },
    {
      label: 'an instance from a different Cuis version',
      name: 'demo',
      kind: 'version_mismatch',
      record: '7.7-0000000',
      hint: undefined,
    },
  ])('runRun for $label fails with $kind before preparing the Cuis home or creating the lock', async ({ name, kind, record, hint }) => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      if (record !== undefined) {
        const dir = path.join(home, 'instances', name);
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, 'instance.json'),
          JSON.stringify({ name, cuisKey: record, createdAt: new Date().toISOString() }),
        );
      }
      const before = (await readdir(home)).sort();

      // When
      const result = await runRun({ home, name, ...baseOpts });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe(kind);
      if (hint !== undefined) expect(result.error.hint).toBe(hint);
      if (record !== undefined) {
        expect(result.error.message).toContain(record);
        expect(result.error.message).toContain(CUIS_KEY);
      }
      expect((await readdir(home)).sort()).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it('runRun on an instance whose Cuis home is missing prepares the home first and never fails with home_not_ready', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const { home } = lifecycle;
    const stageDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-run-prepare-test-'));
    const { sha256 } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
    const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
    try {
      await rm(cuisKeyDir(home, CUIS_KEY), { recursive: true, force: true });
      expect(await homeStatus({ home })).toEqual({ state: 'missing' });
      const progress: string[] = [];

      // When
      const result = await runRun({
        home,
        name: 'demo',
        ...baseOpts,
        onProgress: (m: string) => progress.push(m),
        archiveUrl: server.url,
        archiveSha256: sha256,
        startTimeoutMs: 2000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok === false && result.error.kind).not.toBe('home_not_ready');
      expect(server.requestCount()).toBe(1);
      expect(progress.some((m) => m.includes('Preparing Cuis'))).toBe(true);
      expect(await homeStatus({ home })).toEqual({ state: 'ready' });
    } finally {
      await server.close();
      await rm(stageDir, { recursive: true, force: true });
      await lifecycle.cleanup();
    }
  }, 30000);
});
