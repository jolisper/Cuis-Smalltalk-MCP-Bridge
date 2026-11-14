import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startArchiveServer } from '../testSupport/archiveServer.js';
import type { ArchiveServer } from '../testSupport/archiveServer.js';
import { buildFakeArchive } from '../testSupport/fakeDistribution.js';
import { homeStatus } from '../home.js';
import { cuisKeyDir, instancePaths, instancesDir } from '../paths.js';
import { CUIS_KEY } from '../pin.js';
import { makeTempHome } from '../testSupport/tempHome.js';
import { runCreate } from './create.js';

describe('cuisctl create command', () => {
  let home: string;
  let cleanup: () => Promise<void>;
  let stageDir: string;
  let server: ArchiveServer;
  let sha: string;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
    stageDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-create-test-'));
    ({ sha256: sha } = await buildFakeArchive(path.join(stageDir, 'archive.zip')));
    server = await startArchiveServer(path.join(stageDir, 'archive.zip'));
  });

  afterEach(async () => {
    await server.close();
    await rm(stageDir, { recursive: true, force: true });
    await cleanup();
  });

  it('runCreate with an invalid name resolves invalid_name without touching the filesystem or network', async () => {
    // Given
    const opts = {
      home,
      name: 'Foo',
      onProgress: () => {},
      archiveUrl: server.url,
      archiveSha256: sha,
    };

    // When
    const result = await runCreate(opts);

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('invalid_name');
    expect(typeof result.error.message).toBe('string');
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(server.requestCount()).toBe(0);
    expect(await readdir(home)).toEqual([]);
  });

  it('runCreate on a fresh home provisions Cuis and returns a stopped InstanceView', async () => {
    // Given
    const messages: string[] = [];
    const paths = instancePaths(home, 'demo');

    // When
    const result = await runCreate({
      home,
      name: 'demo',
      onProgress: (msg) => messages.push(msg),
      archiveUrl: server.url,
      archiveSha256: sha,
    });

    // Then
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.command).toBe('create');
    expect(result.data).toEqual({
      name: 'demo',
      cuisKey: CUIS_KEY,
      createdAt: expect.any(String),
      state: 'stopped',
      paths: { instance: paths.dir, files: paths.files, log: paths.vmLog },
    });
    expect(messages.length).toBeGreaterThan(0);
    expect(server.requestCount()).toBe(1);
    await expect(access(path.join(paths.dir, 'image', 'Cuis7.8.image'))).resolves.toBeUndefined();
  }, 20000);

  it('runCreate with an existing name resolves already_exists without downloading when the Cuis home is missing', async () => {
    // Given
    const opts = {
      home,
      name: 'demo',
      onProgress: () => {},
      archiveUrl: server.url,
      archiveSha256: sha,
    };
    const first = await runCreate(opts);
    expect(first.ok).toBe(true);
    expect(server.requestCount()).toBe(1);
    const jsonPath = instancePaths(home, 'demo').instanceJson;
    const jsonBefore = await readFile(jsonPath);
    await rm(cuisKeyDir(home, CUIS_KEY), { recursive: true, force: true });

    // When
    const result = await runCreate(opts);

    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('already_exists');
    expect(result.error.message.length).toBeGreaterThan(0);
    if (result.error.hint !== undefined) expect(typeof result.error.hint).toBe('string');
    expect(server.requestCount()).toBe(1);
    expect((await readFile(jsonPath)).equals(jsonBefore)).toBe(true);
    expect(await homeStatus({ home })).toEqual({ state: 'missing' });
  }, 30000);

  it('runCreate resolves the preparation error kind and creates no instance when preparing the Cuis home fails', async () => {
    // Given
    const cases = [
      { label: 'checksum', kind: 'cuis_checksum_mismatch', bootFails: false, behavior: 'ok', badSha: true },
      { label: 'fetch', kind: 'cuis_fetch_failed', bootFails: false, behavior: 'not-found', badSha: false },
      { label: 'base build', kind: 'cuis_base_build_failed', bootFails: true, behavior: 'ok', badSha: false },
    ] as const;

    for (const c of cases) {
      const fresh = await makeTempHome();
      const dir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-create-fail-'));
      const zip = path.join(dir, 'archive.zip');
      const built = await buildFakeArchive(zip, { bootFails: c.bootFails });
      const srv = await startArchiveServer(zip, { behavior: c.behavior });
      try {
        // When
        const result = await runCreate({
          home: fresh.home,
          name: 'demo',
          onProgress: () => {},
          archiveUrl: srv.url,
          archiveSha256: c.badSha ? '0'.repeat(64) : built.sha256,
        });

        // Then
        expect(result.ok, c.label).toBe(false);
        if (result.ok) throw new Error(`expected failure for ${c.label}`);
        expect(result.error.kind, c.label).toBe(c.kind);
        expect(result.error.message.length, c.label).toBeGreaterThan(0);
        await expect(access(instancesDir(fresh.home)), c.label).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await srv.close();
        await rm(dir, { recursive: true, force: true });
        await fresh.cleanup();
      }
    }
  }, 40000);
});
