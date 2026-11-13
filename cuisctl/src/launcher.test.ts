import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, spawnVm, vmArgv } from './launcher.js';
import { fakeShScript, writeFakeVm } from './testSupport/fakeVm.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl launcher', () => {
  it('builds a headless argv running the script, ending with -ApplePersistenceIgnoreState YES and no -u or package options', () => {
    // Given
    const image = '/i/Cuis7.8.image';
    const script = '/s/run.st';

    // When
    const argv = vmArgv(image, script);

    // Then
    expect(argv).toEqual([
      '-headless',
      '/i/Cuis7.8.image',
      '-s',
      '/s/run.st',
      '-ApplePersistenceIgnoreState',
      'YES',
    ]);
  });

  it('builds a GUI argv without -headless when headless is false, keeping the -ApplePersistenceIgnoreState YES suffix', () => {
    // Given
    const image = '/i/Cuis7.8.image';
    const script = '/s/run.st';

    // When
    const argv = vmArgv(image, script, { headless: false });

    // Then
    expect(argv).toEqual([
      '/i/Cuis7.8.image',
      '-s',
      '/s/run.st',
      '-ApplePersistenceIgnoreState',
      'YES',
    ]);
  });

  it('runScript resolves passed with exitCode 0 and the VM output when the script prints DONE exitCode=0', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, fakeShScript('echo "DONE exitCode=0"\nexit 0\n'));

      // When
      const result = await runScript({
        vm,
        image,
        script,
        cwd: home,
        timeoutMs: 10000,
        logFile: path.join(home, 'vm.log'),
      });

      // Then
      expect(result.outcome).toBe('passed');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('DONE exitCode=0');
    } finally {
      await cleanup();
    }
  });

  it('runScript resolves failed with the VM exitCode when the script prints DONE exitCode=1 and exits 1', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, fakeShScript('echo "DONE exitCode=1"\nexit 1\n'));

      // When
      const result = await runScript({
        vm,
        image,
        script,
        cwd: home,
        timeoutMs: 10000,
        logFile: path.join(home, 'vm.log'),
      });

      // Then
      expect(result.outcome).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('DONE exitCode=1');
    } finally {
      await cleanup();
    }
  });

  it('runScript kills a hanging VM and its grandchild at the time limit and resolves timeout_or_crash with exitCode 124 without waiting for the hang', async () => {
    // Given a fake VM whose script starts a background sleep, records its pid, then hangs
    const { home, cleanup } = await makeTempHome();
    const pidFile = path.join(home, 'grandchild.pid');
    let pid: number | undefined;
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(
        script,
        fakeShScript(`sleep 60 & echo $! > "${pidFile}"; echo started\nsleep 60\n`),
      );

      // When the time limit is 3 s (generous so the script has certainly written the pid file)
      const startedAt = Date.now();
      const result = await runScript({
        vm,
        image,
        script,
        cwd: home,
        timeoutMs: 3000,
        logFile: path.join(home, 'vm.log'),
      });
      const elapsed = Date.now() - startedAt;

      // Then
      expect(result.outcome).toBe('timeout_or_crash');
      expect(result.exitCode).toBe(124);
      expect(elapsed).toBeLessThan(15000);
      expect(result.output).toContain('started');
      for (let i = 0; i < 100 && pid === undefined; i++) {
        const n = Number((await fs.readFile(pidFile, 'utf8').catch(() => '')).trim());
        if (Number.isInteger(n) && n > 0) pid = n;
        else await new Promise((r) => setTimeout(r, 100));
      }
      expect(pid).toBeDefined();
      let code: string | undefined = 'alive';
      for (let i = 0; i < 100 && code === 'alive'; i++) {
        try {
          process.kill(pid as number, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          code = (e as NodeJS.ErrnoException).code;
        }
      }
      expect(code).toBe('ESRCH');
    } finally {
      if (pid === undefined) {
        try {
          pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
        } catch {
          // pid file never written
        }
      }
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      await cleanup();
    }
  }, 30000);

  it('runScript resolves setup_error with exitCode 2 and names the VM path when the VM does not exist', async () => {
    // Given an existing image and script but a missing VM
    const { home, cleanup } = await makeTempHome();
    try {
      const vm = path.join(home, 'no-such-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, 'Smalltalk quit.\n');

      // When
      const result = await runScript({
        vm,
        image,
        script,
        cwd: home,
        timeoutMs: 10000,
        logFile: path.join(home, 'vm.log'),
      });

      // Then
      expect(result.outcome).toBe('setup_error');
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain(vm);
    } finally {
      await cleanup();
    }
  }, 5000);

  it('runScript resolves setup_error with exitCode 2, names the image path, and never invokes the VM when the image does not exist', async () => {
    // Given a fake VM that logs invocations, an existing script, but a missing image
    const { home, cleanup } = await makeTempHome();
    try {
      const vm = path.join(home, 'fake-vm');
      const invocationLog = path.join(home, 'vm-calls.log');
      const image = path.join(home, 'no-such.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm, { invocationLog });
      await fs.writeFile(script, 'Smalltalk quit.\n');

      // When
      const result = await runScript({
        vm,
        image,
        script,
        cwd: home,
        timeoutMs: 10000,
        logFile: path.join(home, 'vm.log'),
      });

      // Then
      expect(result.outcome).toBe('setup_error');
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain(image);
      await expect(fs.access(invocationLog)).rejects.toThrow();
    } finally {
      await cleanup();
    }
  }, 5000);

  it('spawnVm returns the pid of a live detached VM process and appends its output to the log file', async () => {
    // Given a fake VM whose script prints booted and then keeps running
    const { home, cleanup } = await makeTempHome();
    const logFile = path.join(home, 'vm.log');
    let pid: number | undefined;
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, fakeShScript('echo "booted"\nsleep 60\n'));

      // When
      const spawned = await spawnVm({ vm, image, script, cwd: home, logFile, headless: true });
      pid = spawned.pid;

      // Then the pid is a positive integer for a live process
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid as number, 0)).not.toThrow();

      // And the log eventually contains the VM output
      let log = '';
      for (let i = 0; i < 50 && !log.includes('booted'); i++) {
        log = await fs.readFile(logFile, 'utf8').catch(() => '');
        if (!log.includes('booted')) await new Promise((r) => setTimeout(r, 100));
      }
      expect(log).toContain('booted');
    } finally {
      if (pid) {
        for (const target of [pid, -pid]) {
          try {
            process.kill(target, 'SIGKILL');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
          }
        }
      }
      await cleanup();
    }
  }, 15000);

  it('spawnVm starts the VM as the leader of its own process group', async () => {
    // Given a fake VM that keeps running
    const { home, cleanup } = await makeTempHome();
    let pid: number | undefined;
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, fakeShScript('sleep 60\n'));

      // When
      const spawned = await spawnVm({ vm, image, script, cwd: home, logFile: path.join(home, 'vm.log'), headless: true });
      pid = spawned.pid;

      // Then its process group id equals its pid
      const { stdout } = await promisify(execFile)('ps', ['-o', 'pgid=', '-p', String(pid)]);
      expect(Number(stdout.trim())).toBe(pid);
    } finally {
      if (pid) {
        for (const target of [pid, -pid]) {
          try {
            process.kill(target, 'SIGKILL');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
          }
        }
      }
      await cleanup();
    }
  }, 15000);

  it('spawnVm exited promise resolves with the VM exit code', async () => {
    // Given a fake VM whose script exits with code 3
    const { home, cleanup } = await makeTempHome();
    try {
      const vm = path.join(home, 'fake-vm');
      const image = path.join(home, 'Cuis7.8.image');
      const script = path.join(home, 'run.st');
      await writeFakeVm(vm);
      await fs.writeFile(image, 'image');
      await fs.writeFile(script, fakeShScript('echo bye\nexit 3\n'));

      // When
      const spawned = await spawnVm({ vm, image, script, cwd: home, logFile: path.join(home, 'vm.log'), headless: true });

      // Then
      await expect(spawned.exited).resolves.toBe(3);
    } finally {
      await cleanup();
    }
  }, 15000);
});
