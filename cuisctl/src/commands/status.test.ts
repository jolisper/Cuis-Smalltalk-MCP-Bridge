import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cuisKeyDir, instancePaths } from '../paths.js';
import { CUIS_KEY } from '../pin.js';
import { pidsHoldingFile, processStartTime } from '../processInfo.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { runStatus } from './status.js';
import type { InstanceView } from './status.js';

describe('cuisctl status command', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('runStatus with no name on a fresh home resolves ok with a missing home and no instances, creating nothing', async () => {
    // Given a fresh, empty home

    // When
    const result = await runStatus({ home });

    // Then
    expect(result).toEqual({
      ok: true,
      command: 'status',
      data: { home: { state: 'missing' }, instances: [] },
    });
    expect(await readdir(home)).toEqual([]);
  });

  it('runStatus with an unknown name resolves not_found with a create hint, an invalid name resolves invalid_name, and nothing is created', async () => {
    // Given a fresh, empty home

    // When
    const missing = await runStatus({ home, name: 'nope' });
    const invalid = await runStatus({ home, name: 'Foo' });

    // Then
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('expected failure');
    expect(missing.error.kind).toBe('not_found');
    expect(missing.error.hint).toBe('cuisctl create nope');
    expect(missing.error.message.length).toBeGreaterThan(0);

    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('expected failure');
    expect(invalid.error.kind).toBe('invalid_name');

    expect(await readdir(home)).toEqual([]);
  });

  it('runStatus for an existing stopped instance resolves ok with its stopped view and paths', async () => {
    // Given an existing instance that is not running
    const p = instancePaths(home, 'demo');
    await mkdir(join(p.dir, 'image'), { recursive: true });
    await writeFile(
      join(p.dir, 'instance.json'),
      '{"name":"demo","cuisKey":"7.8-d4f9cc1","createdAt":"2026-01-01T00:00:00.000Z"}',
    );
    await writeFile(join(p.dir, 'image', 'Cuis7.8.image'), '');
    await writeFile(join(p.dir, 'image', 'Cuis7.8.changes'), '');

    // When
    const result = await runStatus({ home, name: 'demo' });

    // Then
    expect(result).toEqual({
      ok: true,
      command: 'status',
      data: {
        name: 'demo',
        cuisKey: '7.8-d4f9cc1',
        createdAt: '2026-01-01T00:00:00.000Z',
        state: 'stopped',
        paths: { instance: p.dir, files: p.files, log: p.vmLog },
      },
    });
  });

  it('runStatus for a running instance reports its run record details and for an untracked one only its pid, leaving the run record untouched', async () => {
    // Given a tracked running instance `demo` and an untracked running instance `lost`
    const writeInstance = async (name: string): Promise<ReturnType<typeof instancePaths>> => {
      const p = instancePaths(home, name);
      await mkdir(p.imageDir, { recursive: true });
      await writeFile(
        join(p.dir, 'instance.json'),
        `{"name":"${name}","cuisKey":"7.8-d4f9cc1","createdAt":"2026-01-01T00:00:00.000Z"}`,
      );
      await writeFile(p.image, '');
      await writeFile(p.changes, '');
      return p;
    };
    const demo = await writeInstance('demo');
    const lost = await writeInstance('lost');
    const live: Array<ReturnType<typeof spawn>> = [];
    try {
      const tracked = spawn('sh', ['-c', 'read x', demo.image], { stdio: ['pipe', 'ignore', 'ignore'] });
      live.push(tracked);
      const trackedPid = tracked.pid as number;
      const runJson = JSON.stringify({
        pid: trackedPid,
        startTime: await processStartTime(trackedPid),
        mode: 'gui',
        bridge: false,
        saveOnStop: true,
        startedAt: '2026-11-12T10:00:00.000Z',
      });
      await writeFile(demo.runRecord, runJson);

      const untracked = spawn('sh', ['-c', 'exec sleep 30 3<"$0"', lost.changes], { stdio: 'ignore' });
      live.push(untracked);
      const untrackedPid = untracked.pid as number;
      for (let attempt = 0; attempt < 50 && !(await pidsHoldingFile(lost.changes)).includes(untrackedPid); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await pidsHoldingFile(lost.changes)).toContain(untrackedPid);

      // When
      const running = await runStatus({ home, name: 'demo' });
      const untrackedResult = await runStatus({ home, name: 'lost' });

      // Then
      expect(running).toEqual({
        ok: true,
        command: 'status',
        data: {
          name: 'demo',
          cuisKey: '7.8-d4f9cc1',
          createdAt: '2026-01-01T00:00:00.000Z',
          state: 'running',
          pid: trackedPid,
          mode: 'gui',
          bridge: false,
          saveOnStop: true,
          startedAt: '2026-11-12T10:00:00.000Z',
          paths: { instance: demo.dir, files: demo.files, log: demo.vmLog },
        },
      });
      expect(untrackedResult.ok).toBe(true);
      if (!untrackedResult.ok) throw new Error('expected success');
      const untrackedData = untrackedResult.data as InstanceView;
      expect(untrackedData.state).toBe('running_untracked');
      expect(untrackedData).toHaveProperty('pid', untrackedPid);
      expect(untrackedData).not.toHaveProperty('mode');
      expect(untrackedData).not.toHaveProperty('bridge');
      expect(untrackedData).not.toHaveProperty('saveOnStop');
      expect(untrackedData).not.toHaveProperty('startedAt');
      expect(await readFile(demo.runRecord)).toEqual(Buffer.from(runJson));
    } finally {
      for (const child of live) child.kill();
    }
  });

  it('runStatus changes nothing on disk or in the process list across ready, stale, running and untracked states', async () => {
    // Given a ready home with a stopped instance holding a stale run record, a running one and an untracked one
    await mkdir(cuisKeyDir(home, CUIS_KEY), { recursive: true });
    const writeInstance = async (name: string): Promise<ReturnType<typeof instancePaths>> => {
      const p = instancePaths(home, name);
      await mkdir(p.imageDir, { recursive: true });
      await writeFile(
        join(p.dir, 'instance.json'),
        `{"name":"${name}","cuisKey":"7.8-d4f9cc1","createdAt":"2026-01-01T00:00:00.000Z"}`,
      );
      await writeFile(p.image, '');
      await writeFile(p.changes, '');
      return p;
    };
    const alpha = await writeInstance('alpha');
    const beta = await writeInstance('beta');
    const gamma = await writeInstance('gamma');

    const snapshotTree = async (root: string, rel = ''): Promise<unknown[]> => {
      const entries: unknown[] = [];
      for (const entry of (await readdir(join(root, rel))).sort()) {
        const relPath = join(rel, entry);
        const stats = await lstat(join(root, relPath));
        const type = stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'dir' : stats.isFile() ? 'file' : 'other';
        const hash =
          type === 'file' ? createHash('sha256').update(await readFile(join(root, relPath))).digest('hex') : null;
        entries.push({ path: relPath, type, size: stats.size, mtimeMs: stats.mtimeMs, hash });
        if (type === 'dir') entries.push(...(await snapshotTree(root, relPath)));
      }
      return entries;
    };

    const live: Array<ReturnType<typeof spawn>> = [];
    try {
      const exited = spawn('true', [], { stdio: 'ignore' });
      await new Promise((resolve) => exited.once('exit', resolve));
      await writeFile(
        alpha.runRecord,
        JSON.stringify({
          pid: exited.pid,
          startTime: 'Thu Jan  1 00:00:00 1970',
          mode: 'gui',
          bridge: false,
          saveOnStop: false,
          startedAt: '2026-11-12T10:00:00.000Z',
        }),
      );

      const tracked = spawn('sh', ['-c', 'read x', beta.image], { stdio: ['pipe', 'ignore', 'ignore'] });
      live.push(tracked);
      const trackedPid = tracked.pid as number;
      await writeFile(
        beta.runRecord,
        JSON.stringify({
          pid: trackedPid,
          startTime: await processStartTime(trackedPid),
          mode: 'gui',
          bridge: false,
          saveOnStop: false,
          startedAt: '2026-11-12T10:00:00.000Z',
        }),
      );

      const untracked = spawn('sh', ['-c', 'exec sleep 30 3<"$0"', gamma.changes], { stdio: 'ignore' });
      live.push(untracked);
      const untrackedPid = untracked.pid as number;
      for (let attempt = 0; attempt < 50 && !(await pidsHoldingFile(gamma.changes)).includes(untrackedPid); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(await pidsHoldingFile(gamma.changes)).toContain(untrackedPid);

      const pids = [trackedPid, untrackedPid];
      const startTimesBefore = await Promise.all(pids.map((pid) => processStartTime(pid)));
      const treeBefore = await snapshotTree(home);

      // When status is run for all instances twice and then for the stale one
      const first = await runStatus({ home });
      const second = await runStatus({ home });
      const treeAfterAll = await snapshotTree(home);
      await runStatus({ home, name: 'alpha' });
      const treeAfterOne = await snapshotTree(home);

      // Then states are reported correctly and nothing on disk or among the processes changed
      for (const result of [first, second]) {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected success');
        const data = result.data as { home: unknown; instances: Array<{ name: string; state: string }> };
        expect(data.home).toEqual({ state: 'ready' });
        expect(data.instances.map((i) => [i.name, i.state])).toEqual([
          ['alpha', 'stopped'],
          ['beta', 'running'],
          ['gamma', 'running_untracked'],
        ]);
      }
      expect(treeAfterAll).toEqual(treeBefore);
      expect(treeAfterOne).toEqual(treeBefore);
      expect(treeBefore).toContainEqual(expect.objectContaining({ path: join('instances', 'alpha', 'run.json'), type: 'file' }));
      for (const pid of pids) expect(() => process.kill(pid, 0)).not.toThrow();
      expect(await Promise.all(pids.map((pid) => processStartTime(pid)))).toEqual(startTimesBefore);
    } finally {
      for (const child of live) child.kill();
    }
  });
});
