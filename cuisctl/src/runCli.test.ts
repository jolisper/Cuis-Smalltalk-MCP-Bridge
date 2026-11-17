import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { withInstanceLock } from './commands/instanceLock.js';
import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runStop } from './commands/stop.js';
import { processStartTime } from './processInfo.js';
import { cuisBaseDir, cuisDistDir, instanceLockFile, instancePaths, locksDir } from './paths.js';
import { CUIS_KEY } from './pin.js';
import { runCli } from './runCli.js';
import { instanceState } from './state.js';
import { startArchiveServer } from './testSupport/archiveServer.js';
import { writeFakeVmConfig } from './testSupport/fakeVm.js';
import { buildFakeArchive } from './testSupport/fakeDistribution.js';
import { makeLifecycleHome } from './testSupport/lifecycleHome.js';
import { makeTempHome } from './testSupport/tempHome.js';

async function snapshotDir(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const name of await fs.readdir(dir)) {
      const full = path.join(dir, name);
      const st = await fs.lstat(full);
      const rel = path.relative(root, full);
      if (st.isDirectory()) {
        out[rel] = `dir mtime=${st.mtimeMs}`;
        await walk(full);
      } else if (st.isSymbolicLink()) {
        out[rel] = `symlink -> ${await fs.readlink(full)}`;
      } else {
        const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
        out[rel] = `file size=${st.size} mtime=${st.mtimeMs} sha=${hash}`;
      }
    }
  }
  await walk(root);
  return out;
}

describe('runCli', () => {
  it('reports a usage error naming create and status when no command is given', async () => {
    // Given
    const ctx = { env: {}, platform: 'darwin' as const, onProgress: () => {} };

    // When
    const { stdout, exitCode } = await runCli([], ctx);

    // Then
    expect(exitCode).toBe(2);
    expect(stdout).toMatch(/^error: .*command/);
    const hint = stdout.split('\n').find((line) => line.startsWith('hint: '));
    expect(hint).toContain('create');
    expect(hint).toContain('status');
    expect(stdout).toMatch(/[^\n]\n$/);
  });

  it('renders status on a fresh home as missing with no instances and leaves the home untouched', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {} };

      // When
      const { stdout, exitCode } = await runCli(['status'], ctx);

      // Then
      expect(exitCode).toBe(0);
      expect(stdout).toBe('Cuis home: missing\nNo instances.\n');
      expect(await fs.readdir(home)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('runs create demo, rendering the created line on stdout and keeping progress out of it', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
    const { sha256: sha } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
    const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
    try {
      const progress: string[] = [];
      const ctx = {
        env: { CUISCTL_HOME: home },
        platform: 'darwin' as const,
        onProgress: (m: string) => progress.push(m),
        createOptions: { archiveUrl: server.url, archiveSha256: sha },
      };

      // When
      const { stdout, exitCode } = await runCli(['create', 'demo'], ctx);

      // Then
      expect(exitCode).toBe(0);
      expect(stdout.startsWith('Created instance demo (Cuis 7.8-d4f9cc1)\n')).toBe(true);
      expect(progress.length).toBeGreaterThan(0);
      for (const message of progress) expect(stdout).not.toContain(message);
      expect(server.requestCount()).toBe(1);
      await expect(fs.access(instancePaths(home, 'demo').instanceJson)).resolves.toBeUndefined();
    } finally {
      await server.close();
      await fs.rm(stageDir, { recursive: true, force: true });
      await cleanup();
    }
  }, 20000);

  it('rejects malformed create/status argv as usage errors naming the problem, before touching the filesystem', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {} };
      const cases: Array<[string[], string]> = [
        [['create'], 'instance name'],
        [['create', 'a', 'b'], 'too many'],
        [['status', 'a', 'b'], 'too many'],
        [['status', '--bogus'], '--bogus'],
        [['create', '--bogus', 'demo'], '--bogus'],
      ];

      for (const [argv, fragment] of cases) {
        // When
        const { stdout, exitCode } = await runCli(argv, ctx);

        // Then
        const label = argv.join(' ');
        expect(exitCode, label).toBe(2);
        expect(stdout.startsWith('error: '), label).toBe(true);
        expect(stdout.split('\n')[0], label).toContain(fragment);
        expect(
          stdout.split('\n').some((line) => line.startsWith('hint: ')),
          label,
        ).toBe(true);
      }
      expect(await fs.readdir(home)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('gives text and --json modes the same exit code, with JSON mode printing exactly one JSON document', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {} };
      const cases: Array<{
        text: string[];
        json: string[][];
        exitCode: number;
        check: (doc: any) => void;
      }> = [
        {
          text: ['status'],
          json: [['status', '--json'], ['--json', 'status']],
          exitCode: 0,
          check: (doc) =>
            expect(doc).toEqual({
              ok: true,
              command: 'status',
              data: { home: { state: 'missing' }, instances: [] },
            }),
        },
        {
          text: ['status', 'nope'],
          json: [['status', 'nope', '--json']],
          exitCode: 1,
          check: (doc) => {
            expect(doc.ok).toBe(false);
            expect(doc.error.kind).toBe('not_found');
            expect(doc.error.hint).toBe('cuisctl create nope');
          },
        },
        {
          text: ['frobnicate'],
          json: [['frobnicate', '--json']],
          exitCode: 2,
          check: (doc) => {
            expect(doc.ok).toBe(false);
            expect(doc.error.kind).toBe('usage');
          },
        },
        {
          text: ['create', 'Foo'],
          json: [['create', 'Foo', '--json']],
          exitCode: 1,
          check: (doc) => {
            expect(doc.ok).toBe(false);
            expect(doc.error.kind).toBe('invalid_name');
          },
        },
      ];

      for (const { text, json, exitCode, check } of cases) {
        // When
        const textRun = await runCli(text, ctx);

        // Then
        const textLabel = text.join(' ');
        expect(textRun.exitCode, textLabel).toBe(exitCode);
        expect(textRun.stdout.startsWith('{'), textLabel).toBe(false);

        for (const argv of json) {
          // When
          const jsonRun = await runCli(argv, ctx);

          // Then
          const label = argv.join(' ');
          expect(jsonRun.exitCode, label).toBe(textRun.exitCode);
          expect(jsonRun.stdout.endsWith('\n'), label).toBe(true);
          expect(jsonRun.stdout.trim().split('\n').length, label).toBe(1);
          check(JSON.parse(jsonRun.stdout));
        }
      }
    } finally {
      await cleanup();
    }
  });

  it.each(['frobnicate'])(
    'reports an unknown-command usage error naming %s',
    async (word) => {
      // Given
      const ctx = { env: {}, platform: 'darwin' as const, onProgress: () => {} };

      // When
      const { stdout, exitCode } = await runCli([word, 'demo'], ctx);

      // Then
      expect(exitCode, word).toBe(2);
      expect(stdout.startsWith('error: '), word).toBe(true);
      expect(stdout.split('\n')[0], word).toContain(word);
      const hint = stdout.split('\n').find((line) => line.startsWith('hint: '));
      expect(hint, word).toContain('create');
      expect(hint, word).toContain('status');
    },
  );

  it.each([
    [['start', 'demo', '--save'], '--save'],
    [['stop', 'demo', '--headless'], '--headless'],
    [['stop', 'demo', '--bridge'], '--bridge'],
    [['create', 'demo', '--save'], '--save'],
    [['create', 'demo', '--headless'], '--headless'],
    [['status', 'demo', '--bridge'], '--bridge'],
  ])('rejects %j as a usage error for a flag the command does not accept, touching nothing', async (argv, flag) => {
    // Given
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
    const home = path.join(parent, 'nonexistent-home');
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {} };

      // When
      const { stdout, exitCode } = await runCli(argv, ctx);

      // Then
      expect(exitCode).toBe(2);
      expect(stdout.split('\n')[0]).toBe(`error: unknown option: ${flag}`);
      const hint = stdout.split('\n').find((line) => line.startsWith('hint: '));
      expect(hint).toContain('usage: cuisctl <');
      for (const command of ['create', 'status', 'start', 'stop']) expect(hint).toContain(command);
      await expect(fs.access(home)).rejects.toThrow();
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it.each([
    [['start', 'demo', '--stdin'], '--stdin'],
    [['start', 'demo', '--detach'], '--detach'],
    [['create', 'demo', '--save'], '--save'],
    [['stop', 'demo', '--detach'], '--detach'],
    [['status', '--file', 'x'], '--file'],
    [['reset', 'demo', '--timeout', '5'], '--timeout'],
    [['destroy', 'demo', '--gui'], '--gui'],
  ])('rejects %j with exit 2 for a run-only flag, never reading stdin and leaving the home untouched', async (argv, flag) => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const readStdin = vi.fn(async () => ({ text: '', isTTY: false }));
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {}, readStdin };
      const before = await snapshotDir(home);

      // When
      const { stdout, exitCode } = await runCli(argv, ctx);

      // Then
      expect(exitCode).toBe(2);
      expect(stdout.split('\n')[0]).toBe(`error: unknown option: ${flag}`);
      expect(readStdin).not.toHaveBeenCalled();
      expect(await snapshotDir(home)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it.each([
    [['run', 'demo'], { text: '', isTTY: false }],
    [['run', 'demo', '3', '--file', '/x'], { text: '', isTTY: false }],
    [['run', 'demo', '   '], { text: '', isTTY: false }],
    [['run', 'demo', '--file', '/nonexistent/prog.st'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--timeout', '0'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--timeout', 'abc'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--timeout', '301'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--timeout', '1.5'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--save', '--detach'], { text: '', isTTY: false }],
    [['run', 'demo', '1', '--headless', '--gui'], { text: '', isTTY: false }],
    [['run', 'demo', '--stdin'], { text: '', isTTY: true }],
    [['run', 'demo', '--stdin'], { text: '', isTTY: false }],
  ])('rejects run usage errors %j with exit 2 before not_found, leaving the home unprepared and starting no VM', async (argv, stdin) => {
    // Given
    const { home, cleanup } = await makeTempHome();
    try {
      const readStdin = vi.fn(async () => stdin);
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'darwin' as const, onProgress: () => {}, readStdin };
      const before = await snapshotDir(home);

      // When
      const { stdout, exitCode } = await runCli(argv, ctx);

      // Then
      expect(exitCode).toBe(2);
      expect(stdout.split('\n')[0]).toMatch(/^error: /);
      expect(await snapshotDir(home)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it.each([
    [['reset', 'demo', '--save'], 'darwin', 2, 'usage', 'unknown option: --save'],
    [['reset', 'demo', '--yes'], 'darwin', 2, 'usage', 'unknown option: --yes'],
    [['destroy', 'demo', '--headless'], 'darwin', 2, 'usage', 'unknown option: --headless'],
    [['destroy', 'demo', '--yes'], 'linux', 1, 'unsupported_platform', undefined],
  ] as const)(
    'rejects %j on %s with exit %i and kind %s (reset/destroy flag and platform rules)',
    async (argv, platform, exitCode, kind, message) => {
      // Given
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
      const home = path.join(parent, 'nonexistent-home');
      try {
        const ctx = { env: { CUISCTL_HOME: home }, platform, onProgress: () => {} };

        // When
        const result = await runCli(['--json', ...argv], ctx);

        // Then
        expect(result.exitCode).toBe(exitCode);
        const doc = JSON.parse(result.stdout);
        expect(doc.error.kind).toBe(kind);
        if (message) {
          expect(doc.error.message).toBe(message);
          expect(doc.error.hint).toContain('reset');
          expect(doc.error.hint).toContain('destroy');
        }
      } finally {
        await fs.rm(parent, { recursive: true, force: true });
      }
    },
  );

  it('refuses invalid instance names with invalid_name in both modes, without any download or change to the home', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
    const { sha256: sha } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
    const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
    try {
      await fs.writeFile(path.join(home, 'keep.txt'), 'keep me');
      await fs.mkdir(path.join(home, 'instances'));
      const before = await snapshotDir(home);
      const ctx = {
        env: { CUISCTL_HOME: home },
        platform: 'darwin' as const,
        onProgress: () => {},
        createOptions: { archiveUrl: server.url, archiveSha256: sha },
      };

      for (const name of ['Foo', '1a', 'a_b', '-a', 'a/b', '..', '']) {
        const argv = name === '-a' ? ['create', '--', '-a'] : ['create', name];

        // When
        const text = await runCli(argv, ctx);
        const afterText = await snapshotDir(home);
        const json = await runCli(['--json', ...argv], ctx);
        const afterJson = await snapshotDir(home);

        // Then
        const label = JSON.stringify(name);
        expect(text.exitCode, label).toBe(1);
        expect(text.stdout.split('\n')[0].startsWith('error: '), label).toBe(true);
        expect(json.exitCode, label).toBe(1);
        expect(json.stdout.trim().split('\n').length, label).toBe(1);
        expect(JSON.parse(json.stdout).error.kind, label).toBe('invalid_name');
        expect(server.requestCount(), label).toBe(0);
        expect(afterText, label).toEqual(before);
        expect(afterJson, label).toEqual(before);
      }
    } finally {
      await server.close();
      await fs.rm(stageDir, { recursive: true, force: true });
      await cleanup();
    }
  }, 30000);

  it('fails create with unsupported_platform off macOS before any download or validation, while status still works', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
    const { sha256: sha } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
    const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
    try {
      const linuxCtx = {
        env: { CUISCTL_HOME: home },
        platform: 'linux' as const,
        onProgress: () => {},
        createOptions: { archiveUrl: server.url, archiveSha256: sha },
      };

      // When
      const text = await runCli(['create', 'demo'], linuxCtx);
      const json = await runCli(['create', 'demo', '--json'], linuxCtx);
      const invalidName = await runCli(['create', 'Foo', '--json'], {
        ...linuxCtx,
        platform: 'win32' as const,
      });
      const status = await runCli(['status'], linuxCtx);

      // Then
      expect(text.exitCode).toBe(1);
      expect(text.stdout.split('\n')[0]).toMatch(/^error: .*macOS/);
      expect(json.exitCode).toBe(1);
      expect(JSON.parse(json.stdout).error.kind).toBe('unsupported_platform');
      expect(invalidName.exitCode).toBe(1);
      expect(JSON.parse(invalidName.stdout).error.kind).toBe('unsupported_platform');
      expect(server.requestCount()).toBe(0);
      expect(await fs.readdir(home)).toEqual([]);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toBe('Cuis home: missing\nNo instances.\n');
    } finally {
      await server.close();
      await fs.rm(stageDir, { recursive: true, force: true });
      await cleanup();
    }
  }, 20000);

  it('runs start demo --headless, rendering running state, then a second start --json is a no-op', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        startOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const first = await runCli(['start', 'demo', '--headless'], ctx);
      const state = await instanceState(lifecycle.home, 'demo');
      const second = await runCli(['start', 'demo', '--headless', '--json'], ctx);

      // Then
      expect(first.exitCode).toBe(0);
      expect(first.stdout.startsWith('demo: running\n')).toBe(true);
      expect(first.stdout).toContain('mode:   headless');
      expect(state.state).toBe('running');
      expect(state.state === 'running' && state.mode).toBe('headless');
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(second.stdout).data.alreadyRunning).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs stop demo --save, saving and stopping the instance, then a second stop reports already stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        startOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
        stopOptions: { pollIntervalMs: 50 },
      };
      const started = await runCli(['start', 'demo', '--headless'], ctx);
      expect(started.exitCode).toBe(0);
      const sizeBefore = (await fs.stat(lifecycle.paths.image)).size;

      // When
      const first = await runCli(['stop', 'demo', '--save'], ctx);
      const state = await instanceState(lifecycle.home, 'demo');
      const sizeAfter = (await fs.stat(lifecycle.paths.image)).size;
      const second = await runCli(['stop', 'demo'], ctx);

      // Then
      expect(first.exitCode).toBe(0);
      expect(first.stdout).toBe('demo: stopped, saved\n');
      expect(sizeAfter).toBeGreaterThan(sizeBefore);
      expect(state.state).toBe('stopped');
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toBe('demo: already stopped\n');
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs run demo "3 + 4", rendering the passed header and result on stdout and leaving the instance stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', elapsedMs: 12 });
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const { stdout, exitCode } = await runCli(['run', 'demo', '3 + 4'], ctx);
      const state = await instanceState(lifecycle.home, 'demo');

      // Then
      expect(exitCode).toBe(0);
      expect(stdout).toContain('demo: passed (12 ms)');
      expect(stdout).toContain('result: 7');
      expect(state.state).toBe('stopped');
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('treats a dash-leading code argument as an unknown option, and runs it as code after the -- separator', async () => {
    // Given a fresh temp home for the bare form and a lifecycle home with a passing fake VM for the separated form
    const fresh = await makeTempHome();
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '1', elapsedMs: 3 });
      const bareCtx = { env: { CUISCTL_HOME: fresh.home }, platform: 'darwin' as const, onProgress: () => {} };
      const sepCtx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };
      const before = await snapshotDir(fresh.home);

      // When
      const bare = await runCli(['run', 'demo', '-1 abs'], bareCtx);
      const separated = await runCli(['run', 'demo', '--', '-1 abs'], sepCtx);

      // Then
      expect(bare.exitCode).toBe(2);
      expect(bare.stdout.split('\n')[0]).toMatch(/^error: unknown option/);
      expect(await snapshotDir(fresh.home)).toEqual(before);
      expect(separated.exitCode).toBe(0);
      expect(separated.stdout).toContain('demo: passed');
      expect(separated.stdout).toContain('-1 abs');
    } finally {
      await fresh.cleanup();
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs run demo "[true] whileTrue" --timeout 1 against a hanging VM, rendering timed out with an error and leaving the instance stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'hang' });
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const { stdout, exitCode } = await runCli(['run', 'demo', '[true] whileTrue', '--timeout', '1'], ctx);
      const state = await instanceState(lifecycle.home, 'demo');

      // Then
      expect(exitCode).toBe(1);
      expect(stdout.startsWith('demo: timed out (')).toBe(true);
      expect(stdout).toContain('error:');
      expect(state.state).toBe('stopped');
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('aborts a run in flight via ctx.signal, emitting interrupted JSON, restoring the image, removing run.json and releasing the instance lock', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'hang' });
      const imageBefore = (await fs.readFile(lifecycle.paths.image)).toString();
      const controller = new AbortController();
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
        signal: controller.signal,
      };

      // When
      const pending = runCli(['run', 'demo', '[true] whileTrue', '--json'], ctx);
      const deadline = Date.now() + 5000;
      for (;;) {
        const recordExists = await fs.access(lifecycle.paths.runRecord).then(() => true, () => false);
        const log = await fs.readFile(lifecycle.paths.vmLog, 'utf8').catch(() => '');
        if (recordExists && log.includes('BEGIN')) break;
        if (Date.now() > deadline) throw new Error('run never reached BEGIN');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      controller.abort();
      const { stdout, exitCode } = await Promise.race([
        pending,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('run did not settle after abort')), 5000)),
      ]);
      const state = await instanceState(lifecycle.home, 'demo');
      const imageAfter = (await fs.readFile(lifecycle.paths.image)).toString();
      const recordLeft = await fs.access(lifecycle.paths.runRecord).then(() => true, () => false);
      const lockAcquired = await withInstanceLock(lifecycle.home, 'demo', async () => true);

      // Then
      expect(exitCode).toBe(1);
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, command: 'run', error: { kind: 'interrupted' } });
      expect(state.state).toBe('stopped');
      expect(imageAfter).toBe(imageBefore);
      expect(recordLeft).toBe(false);
      expect(lockAcquired).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 20000);

  it('runs run demo "1 + 1" --gui --detach, reporting detached and leaving the instance running in gui mode', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '2', onTerm: 'save', armed: true });
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      try {
        // When
        const { stdout, exitCode } = await runCli(['run', 'demo', '1 + 1', '--gui', '--detach'], ctx);
        const state = await instanceState(lifecycle.home, 'demo');

        // Then
        expect(exitCode).toBe(0);
        expect(stdout).toContain('detached: yes');
        expect(state.state).toBe('running');
        expect(state.state === 'running' && state.mode).toBe('gui');
      } finally {
        await runStop({ home: lifecycle.home, name: 'demo', pollIntervalMs: 50 });
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs run demo "3 + 4" --save --headless, saving the image, launching headless and leaving the instance stopped', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', onTerm: 'save', armed: true });
      const imageBefore = (await fs.readFile(lifecycle.paths.image)).toString();
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const { stdout, exitCode } = await runCli(['run', 'demo', '3 + 4', '--save', '--headless'], ctx);
      const state = await instanceState(lifecycle.home, 'demo');
      const log = await fs.readFile(lifecycle.invocationLog, 'utf8').catch(() => '');
      const imageAfter = (await fs.readFile(lifecycle.paths.image)).toString();

      // Then
      expect(exitCode).toBe(0);
      expect(stdout).toContain('saved: yes');
      expect(log).toContain('-headless');
      expect(state.state).toBe('stopped');
      expect(imageAfter).toBe(`${imageBefore}saved\n`);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs run demo --file prog.st --json, emitting a single JSON line whose output echoes the file contents', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', elapsedMs: 12 });
      const progPath = path.join(lifecycle.home, 'prog.st');
      await fs.writeFile(progPath, "Transcript show: 'from file'");
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const { stdout, exitCode } = await runCli(['run', 'demo', '--file', progPath, '--json'], ctx);

      // Then
      expect(exitCode).toBe(0);
      expect(stdout.endsWith('\n')).toBe(true);
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
      const parsed = JSON.parse(stdout);
      expect(parsed).toMatchObject({
        ok: true,
        command: 'run',
        data: { name: 'demo', status: 'passed', result: '7', elapsedMs: 12, saved: false, detached: false },
      });
      expect(parsed.data.output).toContain('from file');
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('renders a failed run as run_failed JSON in either flag position and as text with a single error line, keeping progress out of stdout', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'failed', error: 'ZeroDivide', elapsedMs: 3 });
      const progress: string[] = [];
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: (m: string) => progress.push(m),
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
      };

      // When
      const jsonTail = await runCli(['run', 'demo', '1/0', '--json'], ctx);
      const jsonHead = await runCli(['--json', 'run', 'demo', '1/0'], ctx);
      const text = await runCli(['run', 'demo', '1/0'], ctx);

      // Then
      for (const r of [jsonTail, jsonHead]) {
        expect(r.exitCode).toBe(1);
        expect(r.stdout.endsWith('\n')).toBe(true);
        expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
        expect(JSON.parse(r.stdout)).toMatchObject({
          ok: false,
          command: 'run',
          error: { kind: 'run_failed' },
          data: { name: 'demo', status: 'failed', error: 'ZeroDivide', elapsedMs: 3, saved: false, detached: false },
        });
      }
      expect(JSON.parse(jsonHead.stdout)).toEqual(JSON.parse(jsonTail.stdout));
      expect(text.exitCode).toBe(1);
      expect(text.stdout.startsWith('demo: failed (3 ms)')).toBe(true);
      expect(text.stdout.endsWith('error: ZeroDivide\n')).toBe(true);
      expect(text.stdout.split('\n').filter((l) => l.startsWith('error:'))).toHaveLength(1);
      expect(text.stdout).not.toContain('hint:');
      for (const out of [jsonTail.stdout, jsonHead.stdout, text.stdout]) {
        for (const m of progress) expect(out).not.toContain(m);
      }
    } finally {
      await lifecycle.cleanup();
    }
  }, 60000);

  it('runs run demo --stdin, reading stdin exactly once for the code and never reading stdin for other invocations', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      await writeFakeVmConfig(lifecycle.paths.imageDir, { run: 'passed', result: '7', elapsedMs: 12 });
      const readStdin = vi.fn(async () => ({ text: 'Transcript show: 3', isTTY: false }));
      const ctx = {
        env: { CUISCTL_HOME: lifecycle.home },
        platform: 'darwin' as const,
        onProgress: () => {},
        runOptions: { startTimeoutMs: 10000, pollIntervalMs: 50 },
        readStdin,
      };

      // When
      const viaStdin = await runCli(['run', 'demo', '--stdin'], ctx);
      const callsAfterStdin = readStdin.mock.calls.length;
      readStdin.mockClear();
      await runCli(['run', 'demo', '3 + 4'], ctx);
      await runCli(['status'], ctx);
      await runCli(['status', 'demo'], ctx);

      // Then
      expect(viaStdin.exitCode).toBe(0);
      expect(viaStdin.stdout).toContain('demo: passed');
      expect(viaStdin.stdout).toContain('Transcript show: 3');
      expect(callsAfterStdin).toBe(1);
      expect(readStdin).not.toHaveBeenCalled();
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs reset demo on a stopped instance, rendering the pristine-base line in text mode and ok JSON in --json mode', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const ctx = { env: { CUISCTL_HOME: lifecycle.home }, platform: 'darwin' as const, onProgress: () => {} };

      // When
      const json = await runCli(['reset', 'demo', '--json'], ctx);
      const text = await runCli(['reset', 'demo'], ctx);

      // Then
      expect(json.exitCode).toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, command: 'reset' });
      expect(text.exitCode).toBe(0);
      expect(text.stdout.startsWith('demo: reset to the pristine base (Cuis ')).toBe(true);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('runs destroy demo requiring --yes: without it confirmation_required and the folder stays, with it ok and the folder is gone', async () => {
    // Given
    const lifecycle = await makeLifecycleHome();
    try {
      const ctx = { env: { CUISCTL_HOME: lifecycle.home }, platform: 'darwin' as const, onProgress: () => {} };
      const folder = instancePaths(lifecycle.home, 'demo').dir;

      // When
      const refused = await runCli(['destroy', 'demo', '--json'], ctx);
      const folderAfterRefusal = await fs.stat(folder).then(() => true, () => false);
      const confirmed = await runCli(['destroy', 'demo', '--yes', '--json'], ctx);
      const folderAfterConfirm = await fs.stat(folder).then(() => true, () => false);

      // Then
      expect(refused.exitCode).toBe(1);
      expect(JSON.parse(refused.stdout)).toMatchObject({
        ok: false,
        error: { kind: 'confirmation_required', hint: 'cuisctl destroy demo --yes' },
      });
      expect(folderAfterRefusal).toBe(true);
      expect(confirmed.exitCode).toBe(0);
      expect(JSON.parse(confirmed.stdout)).toMatchObject({ ok: true, command: 'destroy' });
      expect(folderAfterConfirm).toBe(false);
    } finally {
      await lifecycle.cleanup();
    }
  }, 30000);

  it('create beta writes only under instances/beta, leaving the Cuis home dist/base and alpha untouched', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-test-'));
    const { sha256: sha } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
    const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
    try {
      const ctx = {
        env: { CUISCTL_HOME: home },
        platform: 'darwin' as const,
        onProgress: () => {},
        createOptions: { archiveUrl: server.url, archiveSha256: sha },
      };
      const first = await runCli(['create', 'alpha'], ctx);
      expect(first.exitCode).toBe(0);
      expect(server.requestCount()).toBe(1);
      const s1 = await snapshotDir(home);
      const distAfterPrep = await snapshotDir(cuisDistDir(home, CUIS_KEY));
      const baseAfterPrep = await snapshotDir(cuisBaseDir(home, CUIS_KEY));

      // When
      const second = await runCli(['create', 'beta'], ctx);
      const s2 = await snapshotDir(home);
      const status = await runCli(['status'], ctx);

      // Then
      expect(second.exitCode).toBe(0);
      expect(server.requestCount()).toBe(1);
      for (const rel of Object.keys(s2)) {
        if (rel in s1) continue;
        const sep = path.sep;
        const ok = rel === path.join('instances', 'beta') || rel.startsWith(`${path.join('instances', 'beta')}${sep}`);
        expect(ok, `unexpected new path outside instances/beta: ${rel}`).toBe(true);
      }
      for (const [rel, value] of Object.entries(s1)) {
        expect(rel in s2, `path vanished: ${rel}`).toBe(true);
        if (rel === 'instances' || rel === 'tmp') continue;
        expect(s2[rel], `path changed: ${rel}`).toBe(value);
      }
      expect(await fs.readdir(path.join(home, 'tmp'))).toEqual([]);
      expect((await fs.readdir(path.join(home, 'instances'))).sort()).toEqual(['alpha', 'beta']);
      expect(await snapshotDir(cuisDistDir(home, CUIS_KEY))).toEqual(distAfterPrep);
      expect(await snapshotDir(cuisBaseDir(home, CUIS_KEY))).toEqual(baseAfterPrep);
      expect(status.exitCode).toBe(0);
      const lines = status.stdout.split('\n');
      expect(lines[0]).toBe('Cuis home: ready');
      expect(status.stdout).toContain('alpha  stopped\nbeta   stopped');
    } finally {
      await server.close();
      await fs.rm(stageDir, { recursive: true, force: true });
      await cleanup();
    }
  }, 40000);

  it('fails start and stop with unsupported_platform off macOS without creating the home', async () => {
    // Given
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-unsupported-'));
    const home = path.join(parent, 'nonexistent-home');
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'linux' as const, onProgress: () => {} };

      // When
      const startText = await runCli(['start', 'demo'], ctx);
      const startJson = await runCli(['start', 'demo', '--json'], ctx);
      const stopText = await runCli(['stop', 'demo'], ctx);
      const stopJson = await runCli(['stop', 'demo', '--json'], ctx);

      // Then
      for (const text of [startText, stopText]) {
        expect(text.exitCode).toBe(1);
        expect(text.stdout.split('\n')[0]).toMatch(/^error: .*macOS/);
      }
      for (const json of [startJson, stopJson]) {
        expect(json.exitCode).toBe(1);
        expect(JSON.parse(json.stdout).error.kind).toBe('unsupported_platform');
      }
      await expect(fs.access(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});

describe('run off macOS', () => {
  it('fails run with unsupported_platform, exit 1 and nothing touched, without creating the home', async () => {
    // Given
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-runcli-run-unsupported-'));
    const home = path.join(parent, 'nonexistent-home');
    try {
      const ctx = { env: { CUISCTL_HOME: home }, platform: 'linux' as const, onProgress: () => {} };

      // When
      const text = await runCli(['run', 'demo', '1'], ctx);
      const json = await runCli(['run', 'demo', '1', '--json'], ctx);

      // Then
      expect(text.exitCode).toBe(1);
      expect(text.stdout.split('\n')[0]).toMatch(/^error: .*macOS/);
      expect(json.exitCode).toBe(1);
      expect(JSON.parse(json.stdout).error.kind).toBe('unsupported_platform');
      await expect(fs.access(home)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});

describe('status while an instance runs and its lock is held', () => {
  it('never blocks, changes nothing in the home, and reports the running instance in every status form', async () => {
    // Given a running demo instance and a live process holding its instance lock
    const lh = await makeLifecycleHome();
    const child = spawn('sleep', ['30']);
    try {
      const started = await runStart({
        home: lh.home,
        name: 'demo',
        headless: true,
        onProgress: () => {},
        startTimeoutMs: 10000,
        pollIntervalMs: 50,
      });
      expect(started.ok).toBe(true);
      const pid = child.pid as number;
      await fs.mkdir(locksDir(lh.home), { recursive: true });
      await fs.writeFile(
        instanceLockFile(lh.home, 'demo'),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );
      const before = await snapshotDir(lh.home);
      const ctx = { env: { CUISCTL_HOME: lh.home }, platform: 'darwin' as const, onProgress: () => {} };
      const timed = async <T>(fn: () => Promise<T>): Promise<T> => {
        const t0 = Date.now();
        const r = await fn();
        expect(Date.now() - t0).toBeLessThan(2000);
        return r;
      };

      // When
      const list = await timed(() => runStatus({ home: lh.home }));
      const named = await timed(() => runStatus({ home: lh.home, name: 'demo' }));
      const cliOut = [
        await timed(() => runCli(['status'], ctx)),
        await timed(() => runCli(['status', 'demo'], ctx)),
        await timed(() => runCli(['--json', 'status'], ctx)),
        await timed(() => runCli(['--json', 'status', 'demo'], ctx)),
      ];

      // Then
      expect(list.ok).toBe(true);
      expect(named.ok).toBe(true);
      if (!named.ok) throw new Error('unreachable');
      expect(named.data).toMatchObject({ name: 'demo', state: 'running', saveOnStop: true });
      for (const r of cliOut) expect(r.exitCode).toBe(0);
      expect(JSON.parse(cliOut[3].stdout).data).toMatchObject({ state: 'running', saveOnStop: true });
      expect(await snapshotDir(lh.home)).toEqual(before);
    } finally {
      child.kill();
      await lh.cleanup();
    }
  }, 30000);
});
