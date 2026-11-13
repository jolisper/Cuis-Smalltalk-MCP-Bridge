import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstance } from '../instance.js';
import { cuisBaseDir, instanceDir, instanceLockFile, instancePaths, locksDir } from '../paths.js';
import { CUIS_IMAGE_FILE, CUIS_KEY } from '../pin.js';
import { bridgeAnswers } from '../portCheck.js';
import { pidsHoldingFile, processStartTime } from '../processInfo.js';
import { removeRunRecord } from '../runRecord.js';
import { instanceState } from '../state.js';
import { writeFakeVmConfig } from '../testSupport/fakeVm.js';
import { makeLifecycleHome } from '../testSupport/lifecycleHome.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';

describe('cuisctl start command', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('runStart for a missing instance resolves not_found without creating or spawning anything', async () => {
    // Given
    const opts = { home, name: 'nope', onProgress: () => {} };

    // When
    const result = await runStart(opts);

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('not_found');
    expect(await readdir(home)).toEqual([]);
  });

  it('runStart for an instance from a different Cuis version resolves version_mismatch naming both versions and creates nothing', async () => {
    // Given
    const instanceDir = join(home, 'instances', 'demo');
    await mkdir(instanceDir, { recursive: true });
    await writeFile(
      join(instanceDir, 'instance.json'),
      JSON.stringify({ name: 'demo', cuisKey: '7.7-0000000', createdAt: new Date().toISOString() }),
    );

    // When
    const result = await runStart({ home, name: 'demo', onProgress: () => {} });

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('version_mismatch');
    expect(result.error.message).toContain('7.7-0000000');
    expect(result.error.message).toContain(CUIS_KEY);
    expect(await readdir(home)).not.toContain('locks');
    expect(await readdir(instanceDir)).toEqual(['instance.json']);
  });

  it('runStart on a stopped instance launches the VM headless, writes the run record and returns a running view', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect(result.command).toBe('start');
      const data = result.data as Record<string, unknown>;
      expect(data).toMatchObject({
        state: 'running',
        mode: 'headless',
        bridge: false,
        saveOnStop: true,
        alreadyRunning: false,
        pid: expect.any(Number),
      });
      const pid = data.pid as number;
      expect(() => process.kill(pid, 0)).not.toThrow();
      const record = JSON.parse(await readFile(lifecycle.paths.runRecord, 'utf8'));
      expect(record.pid).toBe(pid);
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStart without a headless option launches the VM in GUI mode from the files directory', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect((result.data as Record<string, unknown>).mode).toBe('gui');
      const record = JSON.parse(await readFile(lifecycle.paths.runRecord, 'utf8'));
      expect(record.mode).toBe('gui');
      const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('-headless');
      expect(lines[0]).toContain('-ApplePersistenceIgnoreState YES');
      const cwd = lines[0]!.slice(lines[0]!.indexOf('cwd=') + 'cwd='.length);
      expect(await realpath(cwd)).toBe(await realpath(lifecycle.paths.files));
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStart on an instance that never becomes ready kills the VM, reports start_failed with the vm.log tail and leaves the instance stopped and the image unchanged', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { neverReady: true });
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 1500,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('start_failed');
      const logLines = (await readFile(lifecycle.paths.vmLog, 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l !== '');
      expect(logLines.length).toBeGreaterThan(0);
      expect(result.error.message).toContain(logLines[logLines.length - 1]!);
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      const deadline = Date.now() + 2000;
      let state = await instanceState(lifecycle.home, lifecycle.name);
      while (state.state !== 'stopped' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        state = await instanceState(lifecycle.home, lifecycle.name);
      }
      expect(state).toEqual({ state: 'stopped' });
      expect(await pidsHoldingFile(lifecycle.paths.changes)).toEqual([]);
      expect((await readFile(lifecycle.paths.image)).equals(imageBefore)).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it('runStart on a VM that exits before becoming ready reports start_failed with the vm.log tail right away instead of waiting for the timeout', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { exitEarly: true });

      // When
      const startedAt = Date.now();
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 30000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - startedAt;

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('start_failed');
      expect(result.error.message).toContain('fake VM: exiting early');
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      expect(await instanceState(lifecycle.home, lifecycle.name)).toEqual({ state: 'stopped' });
      expect(elapsed).toBeLessThan(5000);
    } finally {
      await lifecycle.cleanup();
    }
  }, 40000);

  it('runStart on an instance already running with the same mode and bridge choice is a no-op returning the same pid with alreadyRunning true', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const opts = {
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      };
      const first = await runStart(opts);
      if (!first.ok) throw new Error(`expected success: ${first.error.message}`);
      const firstData = first.data as Record<string, unknown>;
      expect(firstData.alreadyRunning).toBe(false);

      // When
      const second = await runStart(opts);

      // Then
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(`expected success: ${second.error.message}`);
      const secondData = second.data as Record<string, unknown>;
      expect(secondData.alreadyRunning).toBe(true);
      expect(secondData.state).toBe('running');
      expect(secondData.pid).toBe(firstData.pid);
      const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart on an instance running in a different mode fails with instance_running hinting cuisctl stop and spawns nothing', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const base = {
        home: lifecycle.home,
        name: lifecycle.name,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      };
      const first = await runStart({ ...base, headless: true });
      if (!first.ok) throw new Error(`expected success: ${first.error.message}`);

      // When
      const second = await runStart({ ...base, headless: false });

      // Then
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error('expected failure');
      expect(second.error.kind).toBe('instance_running');
      expect(second.error.hint).toBe(`cuisctl stop ${lifecycle.name}`);
      expect(second.error.message).toContain(lifecycle.name);
      const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
      expect((await instanceState(lifecycle.home, lifecycle.name)).state).toBe('running');
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart on a stopped instance with a stale run record removes it even when the start fails', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { neverReady: true });
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
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 1500,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('start_failed');
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
    } finally {
      await lifecycle.cleanup();
    }
  }, 15000);

  it('runStart on a home whose base image file is missing resolves cuis_corrupt and spawns nothing nor writes start.st or run.json', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await rm(join(cuisBaseDir(lifecycle.home, CUIS_KEY), CUIS_IMAGE_FILE));

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('cuis_corrupt');
      const log = await readFile(lifecycle.invocationLog, 'utf8').catch(() => '');
      expect(log.trim()).toBe('');
      const entries = await readdir(instanceDir(lifecycle.home, lifecycle.name));
      expect(entries).not.toContain('start.st');
      expect(entries).not.toContain('run.json');
    } finally {
      await lifecycle.cleanup();
    }
  });

  it('runStart while another process holds the instance lock resolves busy at once without spawning a VM and leaves status unblocked', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      await mkdir(locksDir(lifecycle.home), { recursive: true });
      await writeFile(
        instanceLockFile(lifecycle.home, lifecycle.name),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When
      const startedAt = Date.now();
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - startedAt;
      const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('busy');
      expect(elapsed).toBeLessThan(1000);
      const log = await readFile(lifecycle.invocationLog, 'utf8').catch(() => '');
      expect(log.trim()).toBe('');
      expect(status.ok).toBe(true);
      if (!status.ok) throw new Error(`expected success: ${status.error.message}`);
      expect(status.data).toMatchObject({ state: 'stopped' });
    } finally {
      child.kill();
      await lifecycle.cleanup();
    }
  });

  it('runStart --bridge while something accepts connections on the port resolves port_in_use naming the port, spawns no VM and leaves the holder untouched', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        bridge: true,
        port,
        onProgress: () => {},
        startTimeoutMs: 5000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('port_in_use');
      expect(result.error.message).toContain(String(port));
      const log = await readFile(lifecycle.invocationLog, 'utf8').catch(() => '');
      expect(log.trim()).toBe('');
      const stillAccepting = await new Promise<boolean>((resolve) => {
        const probe = connect({ host: '127.0.0.1', port });
        probe.once('connect', () => {
          probe.destroy();
          resolve(true);
        });
        probe.once('error', () => resolve(false));
      });
      expect(stillAccepting).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await lifecycle.cleanup();
    }
  });

  it('runStart --bridge on a port held by another running managed instance resolves port_in_use naming that instance and leaves it running', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const base = {
        home: lifecycle.home,
        headless: true,
        bridge: true,
        port,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      };
      const first = await runStart({ ...base, name: lifecycle.name });
      if (!first.ok) throw new Error(`expected success: ${first.error.message}`);
      expect((first.data as Record<string, unknown>).bridge).toBe(true);
      await createInstance({ home: lifecycle.home, name: 'other' });

      // When
      const result = await runStart({ ...base, name: 'other' });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('port_in_use');
      expect(result.error.message).toContain(String(port));
      expect(result.error.message).toContain(lifecycle.name);
      const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
      expect(lines).toHaveLength(1);
      expect((await instanceState(lifecycle.home, lifecycle.name)).state).toBe('running');
      expect(await bridgeAnswers(port, 1000)).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart --bridge returns only once the bridge answers a handshake, records bridge true and bakes the port marker into start.st', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      await writeFakeVmConfig(lifecycle.paths.imageDir, { bridgeDelayMs: 1000 });

      // When
      const startedAt = Date.now();
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        bridge: true,
        port,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - startedAt;
      const answers = await bridgeAnswers(port, 1000);

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      const data = result.data as Record<string, unknown>;
      expect(data.bridge).toBe(true);
      expect(data.state).toBe('running');
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(answers).toBe(true);
      const record = JSON.parse(await readFile(lifecycle.paths.runRecord, 'utf8'));
      expect(record.bridge).toBe(true);
      expect(await readFile(lifecycle.paths.startScript, 'utf8')).toContain(`cuisctl-bridge-port: ${port}`);
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart --bridge whose VM listens on all interfaces instead of loopback only kills the VM, reports start_failed saying the bridge is not loopback-only and leaves no run record and the image unchanged', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      await writeFakeVmConfig(lifecycle.paths.imageDir, { bridgeHost: '0.0.0.0' });
      const imageBefore = await readFile(lifecycle.paths.image);

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        bridge: true,
        port,
        onProgress: () => {},
        startTimeoutMs: 5000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('start_failed');
      expect(result.error.message).toContain('loopback');
      await expect(access(lifecycle.paths.runRecord)).rejects.toThrow();
      const deadline = Date.now() + 2000;
      let holders = await pidsHoldingFile(lifecycle.paths.changes);
      while (holders.length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        holders = await pidsHoldingFile(lifecycle.paths.changes);
      }
      expect(holders).toEqual([]);
      expect((await readFile(lifecycle.paths.image)).equals(imageBefore)).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart on an instance whose image is not armed for save-on-stop reports saveOnStop false in the result, the run record and status', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { armed: false });

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      const status = await runStatus({ home: lifecycle.home, name: lifecycle.name });

      // Then
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected success: ${result.error.message}`);
      expect((result.data as Record<string, unknown>).saveOnStop).toBe(false);
      const record = JSON.parse(await readFile(lifecycle.paths.runRecord, 'utf8'));
      expect(record.saveOnStop).toBe(false);
      expect(status.ok).toBe(true);
      if (!status.ok) throw new Error(`expected success: ${status.error.message}`);
      expect(status.data).toMatchObject({ saveOnStop: false });
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runStart while an untracked process holds the instance changes file resolves instance_running hinting cuisctl stop, spawns nothing and never touches the holder', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    let child: ChildProcess | undefined;
    try {
      const fd = openSync(lifecycle.paths.changes, 'a');
      child = spawn('sh', ['-c', 'exec sleep 30'], { stdio: [fd, 'ignore', 'ignore'] });
      closeSync(fd);
      const childPid = child.pid as number;
      const deadline = Date.now() + 3000;
      let holders = await pidsHoldingFile(lifecycle.paths.changes);
      while (!holders.includes(childPid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        holders = await pidsHoldingFile(lifecycle.paths.changes);
      }
      expect(holders).toContain(childPid);
      expect(holders).not.toContain(process.pid);

      // When
      const result = await runStart({
        home: lifecycle.home,
        name: lifecycle.name,
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 5000,
        pollIntervalMs: 50,
      });

      // Then
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.kind).toBe('instance_running');
      expect(result.error.hint).toBe(`cuisctl stop ${lifecycle.name}`);
      const log = await readFile(lifecycle.invocationLog, 'utf8').catch(() => '');
      expect(log.split('\n').filter((l) => l !== '')).toHaveLength(0);
      expect(() => process.kill(childPid, 0)).not.toThrow();
    } finally {
      child?.kill('SIGKILL');
      await lifecycle.cleanup();
    }
  }, 20000);

  it('two racing runStart --bridge on the same port yield exactly one running bridged instance and one port_in_use naming the winner, repeatedly', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await createInstance({ home: lifecycle.home, name: 'other' });
      const otherPaths = instancePaths(lifecycle.home, 'other');
      const instances = [
        { name: 'demo', paths: lifecycle.paths },
        { name: 'other', paths: otherPaths },
      ];
      for (const i of instances) await writeFakeVmConfig(i.paths.imageDir, { bridgeDelayMs: 800 });

      for (let iteration = 0; iteration < 3; iteration++) {
        const probe = createServer();
        await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
        const port = (probe.address() as AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));
        const base = {
          home: lifecycle.home,
          headless: true,
          bridge: true,
          port,
          onProgress: () => {},
          startTimeoutMs: 15000,
          pollIntervalMs: 50,
        };

        // When
        const results = await Promise.all([
          runStart({ ...base, name: 'demo' }),
          runStart({ ...base, name: 'other' }),
        ]);

        // Then
        const winners = results.flatMap((r, idx) => (r.ok ? [instances[idx]!] : []));
        const losers = results.flatMap((r) => (r.ok ? [] : [r]));
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        const loser = losers[0]!;
        if (loser.ok) throw new Error('unreachable');
        expect(loser.error.kind).toBe('port_in_use');
        expect(loser.error.message).toContain(winners[0]!.name);
        const lines = (await readFile(lifecycle.invocationLog, 'utf8')).split('\n').filter((l) => l !== '');
        expect(lines).toHaveLength(1);

        // Cleanup between iterations
        const winner = winners[0]!;
        for (const pid of await pidsHoldingFile(winner.paths.changes)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
        const deadline = Date.now() + 5000;
        while ((await instanceState(lifecycle.home, winner.name)).state !== 'stopped' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        await removeRunRecord(lifecycle.home, winner.name);
        await rm(lifecycle.invocationLog, { force: true });
      }
    } finally {
      for (const pid of await pidsHoldingFile(instancePaths(lifecycle.home, 'other').changes).catch(() => [])) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      await lifecycle.cleanup();
    }
  }, 60000);
});
