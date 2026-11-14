import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CuisctlError } from './errors.js';
import { ensureHome, homeStatus, requireReadyHome } from './home.js';
import {
  cuisBaseDir,
  cuisDistDir,
  cuisErrorFile,
  cuisKeyDir,
  cuisLockFile,
  cuisTmpDir,
} from './paths.js';
import {
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_FILE,
  CUIS_KEY,
  CUIS_SOURCES_FILE,
  CUIS_VM_PATH,
} from './pin.js';
import { processStartTime } from './processInfo.js';
import { startArchiveServer } from './testSupport/archiveServer.js';
import { buildFakeArchive } from './testSupport/fakeDistribution.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl home', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('homeStatus on a fresh home resolves { state: missing }', async () => {
    // Given
    const opts = { home };

    // When
    const status = await homeStatus(opts);

    // Then
    expect(status).toEqual({ state: 'missing' });
  });

  it('homeStatus with the key directory present resolves { state: ready }', async () => {
    // Given
    await mkdir(cuisKeyDir(home, CUIS_KEY), { recursive: true });

    // When
    const status = await homeStatus({ home });

    // Then
    expect(status).toEqual({ state: 'ready' });
  });

  it('homeStatus with no key directory and a live lock resolves { state: preparing }', async () => {
    // Given
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      await mkdir(path.dirname(cuisKeyDir(home, CUIS_KEY)), { recursive: true });
      await writeFile(
        cuisLockFile(home, CUIS_KEY),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When
      const status = await homeStatus({ home });

      // Then
      expect(status).toEqual({ state: 'preparing' });
    } finally {
      child.kill();
    }
  });

  it('homeStatus with no key directory, no lock, and an error file resolves { state: failed } with the recorded error', async () => {
    // Given
    await mkdir(path.dirname(cuisKeyDir(home, CUIS_KEY)), { recursive: true });
    await writeFile(
      cuisErrorFile(home, CUIS_KEY),
      JSON.stringify({ kind: 'cuis_fetch_failed', message: 'boom' }),
    );

    // When
    const status = await homeStatus({ home });

    // Then
    expect(status).toEqual({
      state: 'failed',
      error: { kind: 'cuis_fetch_failed', message: 'boom' },
    });
  });

  it('ensureHome on a fresh home fetches once, installs dist and base, and leaves the home ready', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});

      // Then
      const dist = cuisDistDir(home, CUIS_KEY);
      const base = cuisBaseDir(home, CUIS_KEY);
      await expect(access(path.join(dist, CUIS_VM_PATH))).resolves.toBeUndefined();
      await expect(access(path.join(base, CUIS_IMAGE_FILE))).resolves.toBeUndefined();
      await expect(access(path.join(base, CUIS_CHANGES_FILE))).resolves.toBeUndefined();
      await expect(access(path.join(base, CUIS_SOURCES_FILE))).resolves.toBeUndefined();
      expect(await homeStatus({ home })).toEqual({ state: 'ready' });
      expect(server.requestCount()).toBe(1);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome with an archive whose SHA-256 does not match rejects with cuis_checksum_mismatch and installs nothing', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      const error = await ensureHome(
        { home, archiveUrl: server.url, archiveSha256: '0'.repeat(64) },
        () => {},
      ).catch((err: unknown) => err);

      // Then
      expect(error).toBeInstanceOf(CuisctlError);
      expect((error as CuisctlError).kind).toBe('cuis_checksum_mismatch');
      await expect(access(cuisKeyDir(home, CUIS_KEY))).rejects.toThrow();
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome failing on a checksum mismatch records the error file, removes its tmp directory, and homeStatus reports failed', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      await ensureHome(
        { home, archiveUrl: server.url, archiveSha256: '0'.repeat(64) },
        () => {},
      ).catch(() => undefined);

      // Then
      expect(await homeStatus({ home })).toEqual({
        state: 'failed',
        error: expect.objectContaining({ kind: 'cuis_checksum_mismatch' }),
      });
      expect(await readdir(path.join(home, 'cuis'))).toEqual([
        path.basename(cuisErrorFile(home, CUIS_KEY)),
      ]);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome rejects with cuis_fetch_failed when the download fails (HTTP error status or connection reset)', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    try {
      for (const behavior of ['not-found', 'reset-midstream'] as const) {
        const temp = await makeTempHome();
        const server = await startArchiveServer(zip, { behavior });
        try {
          // When
          const error = await ensureHome(
            { home: temp.home, archiveUrl: server.url, archiveSha256: sha256 },
            () => {},
          ).catch((err: unknown) => err);

          // Then
          expect(error, behavior).toBeInstanceOf(CuisctlError);
          expect((error as CuisctlError).kind, behavior).toBe('cuis_fetch_failed');
        } finally {
          await server.close();
          await temp.cleanup();
        }
      }
    } finally {
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome rejects with cuis_base_build_failed and publishes nothing when the base smoke-boot fails', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip, { bootFails: true });
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      const error = await ensureHome(
        { home, archiveUrl: server.url, archiveSha256: sha256 },
        () => {},
      ).catch((err: unknown) => err);

      // Then
      expect(error).toBeInstanceOf(CuisctlError);
      expect((error as CuisctlError).kind).toBe('cuis_base_build_failed');
      await expect(access(cuisKeyDir(home, CUIS_KEY))).rejects.toThrow();
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome on a failed home clears the stale error file, prepares once, and leaves the home ready', async () => {
    // Given
    await mkdir(path.join(home, 'cuis'), { recursive: true });
    await writeFile(
      cuisErrorFile(home, CUIS_KEY),
      JSON.stringify({ kind: 'cuis_fetch_failed', message: 'earlier' }),
    );
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});

      // Then
      await expect(access(cuisErrorFile(home, CUIS_KEY))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await homeStatus({ home })).toEqual({ state: 'ready' });
      expect(server.requestCount()).toBe(1);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome removes tmp directories left by earlier crashed preparations', async () => {
    // Given
    const leftover = cuisTmpDir(home, CUIS_KEY, 99999999);
    await mkdir(leftover, { recursive: true });
    await writeFile(path.join(leftover, 'partial'), 'crashed');
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      // When
      await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});

      // Then
      expect(await readdir(path.join(home, 'cuis'))).toEqual([
        path.basename(cuisKeyDir(home, CUIS_KEY)),
      ]);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome reports progress while preparing a missing home and reports nothing when the home is already ready', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    const opts = { home, archiveUrl: server.url, archiveSha256: sha256 };
    try {
      // When
      const preparing: string[] = [];
      await ensureHome(opts, (message: string) => preparing.push(message));
      const ready: string[] = [];
      await ensureHome(opts, (message: string) => ready.push(message));

      // Then
      expect(preparing.length).toBeGreaterThan(0);
      for (const message of preparing) {
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
      }
      expect(ready).toEqual([]);
      expect(server.requestCount()).toBe(1);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome while another live process holds the home lock waits for its preparation instead of fetching', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const other = await makeTempHome();
    const otherServer = await startArchiveServer(zip, { behavior: 'ok' });
    const mainServer = await startArchiveServer(zip, { behavior: 'ok' });
    const child = spawn('sleep', ['30']);
    try {
      await ensureHome(
        { home: other.home, archiveUrl: otherServer.url, archiveSha256: sha256 },
        () => {},
      );
      const pid = child.pid as number;
      await mkdir(path.join(home, 'cuis'), { recursive: true });
      await writeFile(
        cuisLockFile(home, CUIS_KEY),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When
      const p = ensureHome(
        { home, archiveUrl: mainServer.url, archiveSha256: sha256, pollIntervalMs: 50 },
        () => {},
      );
      p.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await rename(cuisKeyDir(other.home, CUIS_KEY), cuisKeyDir(home, CUIS_KEY));
      child.kill();
      await rm(cuisLockFile(home, CUIS_KEY), { force: true });
      await p;

      // Then
      expect(mainServer.requestCount()).toBe(0);
      expect(await homeStatus({ home })).toEqual({ state: 'ready' });
    } finally {
      child.kill();
      await mainServer.close();
      await otherServer.close();
      await other.cleanup();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 30000);

  it("ensureHome while another live process holds the home lock rejects with that preparation's error kind when it ends failed", async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    const child = spawn('sleep', ['30']);
    try {
      const pid = child.pid as number;
      await mkdir(path.join(home, 'cuis'), { recursive: true });
      await writeFile(
        cuisLockFile(home, CUIS_KEY),
        JSON.stringify({ pid, startTime: await processStartTime(pid) }),
      );

      // When
      const p = ensureHome(
        { home, archiveUrl: server.url, archiveSha256: sha256, pollIntervalMs: 50 },
        () => {},
      );
      p.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeFile(
        cuisErrorFile(home, CUIS_KEY),
        JSON.stringify({ kind: 'cuis_checksum_mismatch', message: 'other preparer failed' }),
      );
      child.kill();
      await rm(cuisLockFile(home, CUIS_KEY), { force: true });
      const error = await p.then(
        () => undefined,
        (err: unknown) => err,
      );

      // Then
      expect(error).toBeInstanceOf(CuisctlError);
      expect((error as CuisctlError).kind).toBe('cuis_checksum_mismatch');
      expect(server.requestCount()).toBe(0);
    } finally {
      child.kill();
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome on a ready home whose VM is missing rejects with cuis_corrupt and a hint naming the key folder', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    const opts = { home, archiveUrl: server.url, archiveSha256: sha256 };
    try {
      await ensureHome(opts, () => {});
      await rm(path.join(cuisDistDir(home, CUIS_KEY), CUIS_VM_PATH), { force: true });

      // When
      const error = await ensureHome(opts, () => {}).then(
        () => undefined,
        (err: unknown) => err,
      );

      // Then
      expect(error).toBeInstanceOf(CuisctlError);
      expect((error as CuisctlError).kind).toBe('cuis_corrupt');
      expect((error as CuisctlError).hint).toContain(cuisKeyDir(home, CUIS_KEY));
      expect((error as CuisctlError).hint).toContain('run the command again');
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('ensureHome on a ready home missing any base file (image, changes, or sources) rejects with cuis_corrupt', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      for (const file of [CUIS_IMAGE_FILE, CUIS_CHANGES_FILE, CUIS_SOURCES_FILE]) {
        const temp = await makeTempHome();
        try {
          const opts = { home: temp.home, archiveUrl: server.url, archiveSha256: sha256 };
          await ensureHome(opts, () => {});
          await rm(path.join(cuisBaseDir(temp.home, CUIS_KEY), file), { force: true });

          // When
          const error = await ensureHome(opts, () => {}).then(
            () => undefined,
            (err: unknown) => err,
          );

          // Then
          expect(error, file).toBeInstanceOf(CuisctlError);
          expect((error as CuisctlError).kind, file).toBe('cuis_corrupt');
        } finally {
          await temp.cleanup();
        }
      }
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 40000);

  it.skipIf(process.getuid?.() === 0)(
    'ensureHome rejects with cuis_write_failed when the cuis directory is not writable',
    async () => {
      // Given
      const cuisDir = path.join(home, 'cuis');
      await mkdir(cuisDir, { recursive: true });
      await chmod(cuisDir, 0o555);
      const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
      const zip = path.join(archiveDir, 'cuis.zip');
      const { sha256 } = await buildFakeArchive(zip);
      const server = await startArchiveServer(zip, { behavior: 'ok' });
      try {
        // When
        const error = await ensureHome(
          { home, archiveUrl: server.url, archiveSha256: sha256 },
          () => {},
        ).then(
          () => undefined,
          (err: unknown) => err,
        );

        // Then
        expect(error).toBeInstanceOf(CuisctlError);
        expect((error as CuisctlError).kind).toBe('cuis_write_failed');
      } finally {
        await chmod(cuisDir, 0o755);
        await server.close();
        await rm(archiveDir, { recursive: true, force: true });
      }
    },
    20000,
  );

  it('requireReadyHome on a missing home rejects with home_not_ready, a hint to start the instance, and creates nothing', async () => {
    // Given
    const name = 'demo';

    // When
    const error = await requireReadyHome(home, name).then(
      () => undefined,
      (err: unknown) => err,
    );

    // Then
    expect(error).toBeInstanceOf(CuisctlError);
    expect((error as CuisctlError).kind).toBe('home_not_ready');
    expect((error as CuisctlError).message).toContain('missing');
    expect((error as CuisctlError).hint).toBe('cuisctl start demo');
    await expect(access(path.join(home, 'cuis'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requireReadyHome on a ready home with the VM and all base files present resolves without error', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});

      // When
      const result = requireReadyHome(home, 'demo');

      // Then
      await expect(result).resolves.toBeUndefined();
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('requireReadyHome on a ready home missing the base changes file rejects with cuis_corrupt naming the missing path', async () => {
    // Given
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    const { sha256 } = await buildFakeArchive(zip);
    const server = await startArchiveServer(zip, { behavior: 'ok' });
    try {
      await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});
      const changesPath = path.join(cuisBaseDir(home, CUIS_KEY), CUIS_CHANGES_FILE);
      await rm(changesPath, { force: true });

      // When
      const error = await requireReadyHome(home, 'demo').then(
        () => undefined,
        (err: unknown) => err,
      );

      // Then
      expect(error).toBeInstanceOf(CuisctlError);
      expect((error as CuisctlError).kind).toBe('cuis_corrupt');
      expect((error as CuisctlError).message).toContain(changesPath);
    } finally {
      await server.close();
      await rm(archiveDir, { recursive: true, force: true });
    }
  }, 20000);

  it('requireReadyHome on a failed home rejects with home_not_ready, a message naming the failed state, and a hint to start the instance', async () => {
    // Given
    await mkdir(path.dirname(cuisKeyDir(home, CUIS_KEY)), { recursive: true });
    await writeFile(
      cuisErrorFile(home, CUIS_KEY),
      JSON.stringify({ kind: 'cuis_fetch_failed', message: 'boom' }),
    );

    // When
    const error = await requireReadyHome(home, 'demo').then(
      () => undefined,
      (err: unknown) => err,
    );

    // Then
    expect(error).toBeInstanceOf(CuisctlError);
    expect((error as CuisctlError).kind).toBe('home_not_ready');
    expect((error as CuisctlError).message).toContain('failed');
    expect((error as CuisctlError).hint).toBe('cuisctl start demo');
  });
});
