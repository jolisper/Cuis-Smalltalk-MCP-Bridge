import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { pidsHoldingFile } from './processInfo.js';
import { makeLifecycleHome } from './testSupport/lifecycleHome.js';
import { makeTempHome } from './testSupport/tempHome.js';

const cuisctlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(cuisctlDir, 'dist', 'cli.js');

interface EntryResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runEntry(
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; stdin: 'closed' | 'open-pipe' },
): Promise<EntryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: opts.env,
      cwd: opts.cwd,
      stdio: [opts.stdin === 'closed' ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d));
    child.stderr!.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve({ code, stdout, stderr });
    });
  });
}

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
      } else {
        const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
        out[rel] = `file size=${st.size} mtime=${st.mtimeMs} sha=${hash}`;
      }
    }
  }
  await walk(root);
  return out;
}

describe('cuisctl entry point (dist/cli.js)', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(cuisctlDir, 'node_modules/typescript/bin/tsc'), '-p', cuisctlDir],
        (err, stdout) => (err ? reject(new Error(`tsc failed: ${stdout}${err.message}`)) : resolve()),
      );
    });
  }, 120000);

  it('prints the empty status for a fresh home and exits 0 with nothing on stderr', async () => {
    // Given
    const { home, cleanup } = await makeTempHome();
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-cwd-test-'));
    try {
      // When
      const result = await runEntry(['status'], {
        env: { ...process.env, CUISCTL_HOME: home },
        cwd,
        stdin: 'closed',
      });

      // Then
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Cuis home: missing\nNo instances.\n');
      expect(result.stderr).toBe('');
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it('is independent of stdin, cwd and HOME, and uses the documented exit codes', async () => {
    const tmpDirs: string[] = [];
    const mk = async (prefix: string): Promise<string> => {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
      tmpDirs.push(d);
      return d;
    };
    try {
      // Given
      const { home, cleanup } = await makeTempHome();
      tmpDirs.push(home);
      const env = { ...process.env, CUISCTL_HOME: home };
      const cwdA = await mk('cuisctl-cwd-a-');
      const cwdB = await mk('cuisctl-cwd-b-');
      const fakeHome = await mk('cuisctl-fakehome-');
      await fs.mkdir(path.join(fakeHome, '.cuis-mcp-bridge'));
      await fs.writeFile(path.join(fakeHome, '.cuis-mcp-bridge', 'marker.txt'), 'bridge marker');
      await fs.mkdir(path.join(fakeHome, 'Cuis7-8-main'));
      await fs.writeFile(path.join(fakeHome, 'Cuis7-8-main', 'marker.txt'), 'cuis marker');
      try {
        // (a) open stdin pipe
        const closed = await runEntry(['status'], { env, cwd: cwdA, stdin: 'closed' });
        const open = await runEntry(['status'], { env, cwd: cwdA, stdin: 'open-pipe' });
        expect(open.code).toBe(0);
        expect(open.stdout).toBe(closed.stdout);

        // (b) cwd independence, nothing written to cwd
        for (const args of [['status'], ['status', 'nope']]) {
          const a = await runEntry(args, { env, cwd: cwdA, stdin: 'closed' });
          const b = await runEntry(args, { env, cwd: cwdB, stdin: 'closed' });
          expect(b.stdout).toBe(a.stdout);
          expect(b.code).toBe(a.code);
        }
        expect(await fs.readdir(cwdA)).toEqual([]);
        expect(await fs.readdir(cwdB)).toEqual([]);

        // (c) HOME canary without CUISCTL_HOME
        const { CUISCTL_HOME: _omit, ...envNoHome } = process.env;
        const before = await snapshotDir(fakeHome);
        for (const args of [['status'], ['status', 'nope'], ['create', 'Foo']]) {
          await runEntry(args, { env: { ...envNoHome, HOME: fakeHome }, cwd: cwdA, stdin: 'closed' });
        }
        expect(await snapshotDir(fakeHome)).toEqual(before);
        await expect(fs.access(path.join(fakeHome, '.cuisctl'))).rejects.toMatchObject({ code: 'ENOENT' });

        // (d) exit codes in both modes
        const t = await runEntry(['frobnicate'], { env, cwd: cwdA, stdin: 'closed' });
        expect(t.code).toBe(2);
        expect(t.stderr).toBe('');
        const tj = await runEntry(['frobnicate', '--json'], { env, cwd: cwdA, stdin: 'closed' });
        expect(tj.code).toBe(2);
        expect(tj.stderr).toBe('');
        expect(JSON.parse(tj.stdout).error.kind).toBe('usage');
        const c = await runEntry(['create', 'Foo'], { env, cwd: cwdA, stdin: 'closed' });
        expect(c.code).toBe(1);
        expect(c.stderr).toBe('');
        const cj = await runEntry(['create', 'Foo', '--json'], { env, cwd: cwdA, stdin: 'closed' });
        expect(cj.code).toBe(1);
        expect(cj.stderr).toBe('');
        expect(JSON.parse(cj.stdout).error.kind).toBe('invalid_name');
      } finally {
        await cleanup();
      }
    } finally {
      for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true });
    }
  }, 60000);

  describe('lifecycle commands (start/stop)', () => {
    const stripVolatile = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(stripVolatile);
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([k]) => k !== 'pid' && k !== 'startedAt')
            .map(([k, x]) => [k, stripVolatile(x)]),
        );
      }
      return v;
    };

    it('starts without reading stdin, stops from another cwd, keeps JSON shape stable, and leaves HOME and cwds untouched', async () => {
      // Given
      const lc = await makeLifecycleHome();
      const canary = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-canary-home-'));
      const cwdA = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-cwd-a-'));
      const cwdB = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-cwd-b-'));
      try {
        await fs.mkdir(path.join(canary, '.cuis-mcp-bridge'));
        await fs.writeFile(path.join(canary, '.cuis-mcp-bridge', 'marker.txt'), 'bridge marker');
        const before = await snapshotDir(canary);
        const env = { ...process.env, CUISCTL_HOME: lc.home, HOME: canary };

        // When
        const startA = await runEntry(['start', 'demo', '--headless'], { env, cwd: cwdA, stdin: 'open-pipe' });
        const stopB = await runEntry(['stop', 'demo'], { env, cwd: cwdB, stdin: 'closed' });
        const jsonA = await runEntry(['start', 'demo', '--headless', '--json'], { env, cwd: cwdA, stdin: 'closed' });
        const stopA = await runEntry(['stop', 'demo', '--json'], { env, cwd: cwdA, stdin: 'closed' });
        const jsonB = await runEntry(['start', 'demo', '--headless', '--json'], { env, cwd: cwdB, stdin: 'closed' });
        const stopB2 = await runEntry(['stop', 'demo', '--json'], { env, cwd: cwdB, stdin: 'closed' });

        // Then
        expect(startA.code).toBe(0);
        expect(startA.stdout.startsWith('demo: running')).toBe(true);
        expect(stopB.code).toBe(0);
        expect(stopB.stdout).toBe('demo: stopped, not saved\n');
        expect(jsonA.code).toBe(0);
        expect(jsonB.code).toBe(0);
        expect(stopA.code).toBe(0);
        expect(stopB2.code).toBe(0);
        expect(stripVolatile(JSON.parse(jsonB.stdout))).toEqual(stripVolatile(JSON.parse(jsonA.stdout)));
        expect(await snapshotDir(canary)).toEqual(before);
        expect(await fs.readdir(cwdA)).toEqual([]);
        expect(await fs.readdir(cwdB)).toEqual([]);
      } finally {
        await lc.cleanup();
        for (const d of [canary, cwdA, cwdB]) await fs.rm(d, { recursive: true, force: true });
      }
    }, 120000);

    it('gives identical output and exit codes for reset and destroy regardless of stdin and cwd', async () => {
      // Given
      const lc = await makeLifecycleHome();
      const cwdA = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-cwd-a-'));
      const cwdB = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-cwd-b-'));
      try {
        const env = { ...process.env, CUISCTL_HOME: lc.home };
        const cases: Array<{ args: string[]; code: number }> = [
          { args: ['reset', 'demo'], code: 0 },
          { args: ['reset', 'demo', '--json'], code: 0 },
          { args: ['destroy', 'demo'], code: 1 },
          { args: ['destroy', 'demo', '--json'], code: 1 },
          { args: ['reset', 'nope'], code: 1 },
          { args: ['destroy', 'nope', '--yes'], code: 1 },
          { args: ['destroy', 'nope', '--yes', '--json'], code: 1 },
        ];

        for (const { args, code } of cases) {
          // When
          const closedA = await runEntry(args, { env, cwd: cwdA, stdin: 'closed' });
          const openA = await runEntry(args, { env, cwd: cwdA, stdin: 'open-pipe' });
          const closedB = await runEntry(args, { env, cwd: cwdB, stdin: 'closed' });

          // Then
          expect(closedA.code, args.join(' ')).toBe(code);
          expect(openA.code).toBe(closedA.code);
          expect(closedB.code).toBe(closedA.code);
          expect(openA.stdout).toBe(closedA.stdout);
          expect(closedB.stdout).toBe(closedA.stdout);
        }
        expect(await fs.readdir(cwdA)).toEqual([]);
        expect(await fs.readdir(cwdB)).toEqual([]);
      } finally {
        await lc.cleanup();
        for (const d of [cwdA, cwdB]) await fs.rm(d, { recursive: true, force: true });
      }
    }, 120000);

    it('leaves the VM running when the launching process group receives SIGHUP after start exits', async () => {
      // Given
      const lc = await makeLifecycleHome();
      const canary = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-canary-home-'));
      const env = { ...process.env, CUISCTL_HOME: lc.home, HOME: canary };
      try {
        // When
        const child = spawn(process.execPath, [entry, 'start', 'demo', '--headless'], {
          env,
          cwd: canary,
          detached: true,
          stdio: 'ignore',
        });
        const code = await new Promise<number | null>((resolve, reject) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
          child.on('error', reject);
          child.on('close', (c) => {
            clearTimeout(timer);
            resolve(c);
          });
        });
        try {
          process.kill(-child.pid!, 'SIGHUP');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
        }
        await new Promise((r) => setTimeout(r, 500));

        // Then
        expect(code).toBe(0);
        expect((await pidsHoldingFile(lc.paths.changes)).length).toBeGreaterThan(0);
        const status = await runEntry(['status', 'demo', '--json'], { env, cwd: canary, stdin: 'closed' });
        expect(JSON.stringify(JSON.parse(status.stdout))).toContain('"running"');
        expect(status.stdout).toMatch(/"state":\s*"running"/);
      } finally {
        await lc.cleanup();
        await fs.rm(canary, { recursive: true, force: true });
      }
    }, 120000);
  });
});
