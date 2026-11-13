import { spawn } from 'node:child_process';
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CuisctlError } from './errors.js';
import { ensureHome } from './home.js';
import {
  createInstance,
  listInstances,
  readInstance,
  removeInstance,
  resetImage,
  validateName,
} from './instance.js';
import {
  cuisBaseDir,
  cuisDistDir,
  instanceDir,
  instancePaths,
  instancesDir,
  stagingDir,
} from './paths.js';
import { CUIS_CHANGES_FILE, CUIS_IMAGE_FILE, CUIS_KEY, CUIS_SOURCES_FILE } from './pin.js';
import { type ArchiveServer, startArchiveServer } from './testSupport/archiveServer.js';
import { buildFakeArchive } from './testSupport/fakeDistribution.js';
import { snapshotTree } from './testSupport/snapshotTree.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl instance', () => {
  it('refuses a name containing uppercase letters with an invalid_name error', () => {
    // Given
    const name = 'Foo';

    // When
    let caught: unknown;
    try {
      validateName(name);
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(CuisctlError);
    expect((caught as CuisctlError).kind).toBe('invalid_name');
  });

  it('accepts names matching ^[a-z][a-z0-9-]*$ and refuses all others with invalid_name', () => {
    // Given
    const accepted = ['a', 'demo', 'a1', 'my-img'];
    const refused = ['Foo', '1a', 'a_b', '-a', 'a/b', '..', ''];

    // When / Then
    for (const name of accepted) {
      expect(() => validateName(name), `expected "${name}" to be accepted`).not.toThrow();
    }
    for (const name of refused) {
      let caught: unknown;
      try {
        validateName(name);
      } catch (error) {
        caught = error;
      }
      expect(caught, `expected "${name}" to be refused`).toBeInstanceOf(CuisctlError);
      expect((caught as CuisctlError).kind).toBe('invalid_name');
    }
  });
});

describe('createInstance', () => {
  let archiveDir: string;
  let sha256: string;
  let server: ArchiveServer;
  let home: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    ({ sha256 } = await buildFakeArchive(zip));
    server = await startArchiveServer(zip, { behavior: 'ok' });
  }, 20000);

  afterAll(async () => {
    await server.close();
    await rm(archiveDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
    await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});
  }, 20000);

  afterEach(async () => {
    await cleanup();
  });

  it('resolves the instance record and writes the same record to instance.json', async () => {
    // Given
    const name = 'demo';

    // When
    const record = await createInstance({ home, name });

    // Then
    expect(record.name).toBe('demo');
    expect(record.cuisKey).toBe(CUIS_KEY);
    expect(typeof record.createdAt).toBe('string');
    expect(new Date(record.createdAt).toISOString()).toBe(record.createdAt);
    const written = JSON.parse(await readFile(instancePaths(home, name).instanceJson, 'utf8'));
    expect(written).toEqual(record);
  }, 20000);

  it('copies the base image and changes into image/ and symlinks the base sources by absolute path', async () => {
    // Given
    const name = 'demo';
    const baseDir = cuisBaseDir(home, CUIS_KEY);

    // When
    await createInstance({ home, name });

    // Then
    const p = instancePaths(home, name);
    expect((await lstat(p.image)).isFile()).toBe(true);
    expect((await lstat(p.changes)).isFile()).toBe(true);
    expect(
      (await readFile(p.image)).equals(await readFile(path.join(baseDir, CUIS_IMAGE_FILE))),
    ).toBe(true);
    expect(
      (await readFile(p.changes)).equals(await readFile(path.join(baseDir, CUIS_CHANGES_FILE))),
    ).toBe(true);
    expect((await lstat(p.sources)).isSymbolicLink()).toBe(true);
    expect(await readlink(p.sources)).toBe(path.join(baseDir, CUIS_SOURCES_FILE));
  }, 20000);

  it('symlinks CoreUpdates to the Cuis distribution CoreUpdates directory by absolute path', async () => {
    // Given
    const name = 'demo';
    const distDir = cuisDistDir(home, CUIS_KEY);

    // When
    await createInstance({ home, name });

    // Then
    const p = instancePaths(home, name);
    expect((await lstat(p.coreUpdates)).isSymbolicLink()).toBe(true);
    expect(await readlink(p.coreUpdates)).toBe(path.join(distDir, 'CoreUpdates'));
  }, 20000);

  it('mirrors the distribution Packages as real directories with one absolute symlink per file', async () => {
    // Given
    const name = 'demo';
    const shared = path.join(cuisDistDir(home, CUIS_KEY), 'Packages');

    // When
    await createInstance({ home, name });

    // Then
    const pkgs = instancePaths(home, name).packages;
    expect((await lstat(pkgs)).isDirectory()).toBe(true);
    expect((await lstat(path.join(pkgs, 'Features'))).isDirectory()).toBe(true);
    expect((await lstat(path.join(pkgs, 'marker.txt'))).isSymbolicLink()).toBe(true);
    expect(await readlink(path.join(pkgs, 'marker.txt'))).toBe(path.join(shared, 'marker.txt'));
    expect((await lstat(path.join(pkgs, 'Features', 'JSON.pck.st'))).isSymbolicLink()).toBe(true);
    expect(await readlink(path.join(pkgs, 'Features', 'JSON.pck.st'))).toBe(
      path.join(shared, 'Features', 'JSON.pck.st'),
    );
  }, 20000);

  it('creates an empty files/ directory and an empty vm.log file', async () => {
    // Given
    const name = 'demo';

    // When
    await createInstance({ home, name });

    // Then
    const p = instancePaths(home, name);
    expect(await readdir(p.files)).toEqual([]);
    const log = await lstat(p.vmLog);
    expect(log.isFile()).toBe(true);
    expect(log.size).toBe(0);
  }, 20000);

  it('refuses to create an instance whose name already exists, leaving it untouched and no staging left', async () => {
    // Given
    const name = 'demo';
    await createInstance({ home, name });
    const jsonPath = instancePaths(home, name).instanceJson;
    const before = await readFile(jsonPath);

    // When
    let caught: unknown;
    try {
      await createInstance({ home, name });
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(CuisctlError);
    expect((caught as CuisctlError).kind).toBe('already_exists');
    expect((await readFile(jsonPath)).equals(before)).toBe(true);
    const staged = await readdir(stagingDir(home)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    expect(staged).toEqual([]);
  }, 20000);

  it('removes leftover staging whose pid is dead and keeps staging whose pid is alive', async () => {
    // Given
    const dead = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => dead.once('exit', resolve));
    const live = spawn('sleep', ['30']);
    try {
      const deadDir = `old-${dead.pid}-11111111-1111-1111-1111-111111111111`;
      const liveDir = `busy-${live.pid}-22222222-2222-2222-2222-222222222222`;
      for (const dir of [deadDir, liveDir]) {
        await mkdir(path.join(stagingDir(home), dir), { recursive: true });
        await writeFile(path.join(stagingDir(home), dir, 'leftover.txt'), 'x');
      }

      // When
      await createInstance({ home, name: 'demo' });

      // Then
      expect(await readdir(stagingDir(home))).toEqual([liveDir]);
    } finally {
      live.kill();
    }
  }, 20000);

  it('leaves no partial instance and no staging when the build fails midway', async () => {
    // Given
    await rm(path.join(cuisDistDir(home, CUIS_KEY), 'Packages'), { recursive: true, force: true });

    // When
    let caught: unknown;
    try {
      await createInstance({ home, name: 'demo' });
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof CuisctlError) {
      expect(caught.kind).not.toBe('already_exists');
    }
    await expect(access(instanceDir(home, 'demo'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(stagingDir(home))).toEqual([]);
  }, 20000);
});

describe('readInstance', () => {
  let archiveDir: string;
  let sha256: string;
  let server: ArchiveServer;
  let home: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    ({ sha256 } = await buildFakeArchive(zip));
    server = await startArchiveServer(zip, { behavior: 'ok' });
  }, 20000);

  afterAll(async () => {
    await server.close();
    await rm(archiveDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
    await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});
  }, 20000);

  afterEach(async () => {
    await cleanup();
  });

  it('returns the created record and rejects a missing instance with not_found and a create hint', async () => {
    // Given
    const record = await createInstance({ home, name: 'demo' });

    // When
    const read = await readInstance(home, 'demo');
    let caught: unknown;
    try {
      await readInstance(home, 'nope');
    } catch (error) {
      caught = error;
    }

    // Then
    expect(read).toEqual(record);
    expect(caught).toBeInstanceOf(CuisctlError);
    expect((caught as CuisctlError).kind).toBe('not_found');
    expect((caught as CuisctlError).hint).toBe('cuisctl create nope');
  }, 20000);
});

describe('listInstances', () => {
  let home: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('resolves an empty list when instances/ does not exist and does not create it', async () => {
    // Given
    // a fresh home with no instances/ folder

    // When
    const records = await listInstances(home);

    // Then
    expect(records).toEqual([]);
    await expect(access(instancesDir(home))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists valid instances sorted by name, silently skipping bad names, missing json and stray files', async () => {
    // Given
    const root = instancesDir(home);
    const record = (name: string) => ({
      name,
      cuisKey: '7.8-d4f9cc1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    for (const name of ['zeta', 'alpha', 'Bad_Name']) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, 'instance.json'), JSON.stringify(record(name)));
    }
    await mkdir(path.join(root, 'nojson'), { recursive: true });
    await writeFile(path.join(root, 'stray.txt'), 'x');

    // When
    const records = await listInstances(home);

    // Then
    expect(records).toEqual([record('alpha'), record('zeta')]);
  });

  it('skips a plain file with a valid-looking instance name instead of failing the listing', async () => {
    // Given
    const root = instancesDir(home);
    const alpha = {
      name: 'alpha',
      cuisKey: '7.8-d4f9cc1',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await mkdir(path.join(root, 'alpha'), { recursive: true });
    await writeFile(path.join(root, 'alpha', 'instance.json'), JSON.stringify(alpha));
    await writeFile(path.join(root, 'stray'), 'x');

    // When
    const records = await listInstances(home);

    // Then
    expect(records).toEqual([alpha]);
  });
});

describe('resetImage', () => {
  let archiveDir: string;
  let sha256: string;
  let server: ArchiveServer;
  let home: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    ({ sha256 } = await buildFakeArchive(zip));
    server = await startArchiveServer(zip, { behavior: 'ok' });
  }, 20000);

  afterAll(async () => {
    await server.close();
    await rm(archiveDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
    await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});
  }, 20000);

  afterEach(async () => {
    await cleanup();
  });

  it('restores a modified image and changes to be byte-equal to the base image and changes', async () => {
    // Given
    await createInstance({ home, name: 'demo' });
    const p = instancePaths(home, 'demo');
    await appendFile(p.image, 'extra image bytes');
    await appendFile(p.changes, 'extra changes bytes');
    const baseDir = cuisBaseDir(home, CUIS_KEY);

    // When
    await resetImage(home, 'demo');

    // Then
    expect(
      (await readFile(p.image)).equals(await readFile(path.join(baseDir, CUIS_IMAGE_FILE))),
    ).toBe(true);
    expect(
      (await readFile(p.changes)).equals(await readFile(path.join(baseDir, CUIS_CHANGES_FILE))),
    ).toBe(true);
  }, 20000);

  it('recreates a deleted image folder with the base image and changes', async () => {
    // Given
    await createInstance({ home, name: 'demo' });
    const p = instancePaths(home, 'demo');
    await rm(p.imageDir, { recursive: true });
    const baseDir = cuisBaseDir(home, CUIS_KEY);

    // When
    await resetImage(home, 'demo');

    // Then
    expect(
      (await readFile(p.image)).equals(await readFile(path.join(baseDir, CUIS_IMAGE_FILE))),
    ).toBe(true);
    expect(
      (await readFile(p.changes)).equals(await readFile(path.join(baseDir, CUIS_CHANGES_FILE))),
    ).toBe(true);
  }, 20000);

  it.each(['deleted', 'pointing elsewhere'] as const)(
    're-creates the sources symlink to the base sources when it was %s',
    async (setup) => {
      // Given
      await createInstance({ home, name: 'demo' });
      const p = instancePaths(home, 'demo');
      await rm(p.sources);
      const otherDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-other-'));
      try {
        if (setup === 'pointing elsewhere') {
          const other = path.join(otherDir, 'other.sources');
          await writeFile(other, 'not the base sources');
          await symlink(other, p.sources);
        }

        // When
        await resetImage(home, 'demo');

        // Then
        expect((await lstat(p.sources)).isSymbolicLink()).toBe(true);
        expect(await readlink(p.sources)).toBe(
          path.join(cuisBaseDir(home, CUIS_KEY), CUIS_SOURCES_FILE),
        );
      } finally {
        await rm(otherDir, { recursive: true, force: true });
      }
    },
    20000,
  );

  it('leaves the old image, changes and files/ untouched and no temps when the copy fails midway', async () => {
    // Given
    await createInstance({ home, name: 'demo' });
    const p = instancePaths(home, 'demo');
    await appendFile(p.image, 'extra image bytes');
    await appendFile(p.changes, 'extra changes bytes');
    await mkdir(path.join(p.files, 'nested'), { recursive: true });
    await writeFile(path.join(p.files, 'nested', 'user.txt'), 'user content');
    const imageBefore = await readFile(p.image);
    const changesBefore = await readFile(p.changes);
    const filesBefore = await snapshotTree(p.files);
    const failingCopy = async (src: string, dest: string): Promise<void> => {
      const bytes = await readFile(src);
      await writeFile(dest, bytes.subarray(0, Math.floor(bytes.length / 2)));
      throw new Error('disk full');
    };

    // When
    let caught: unknown;
    try {
      await resetImage(home, 'demo', failingCopy);
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('disk full');
    expect((await readFile(p.image)).equals(imageBefore)).toBe(true);
    expect((await readFile(p.changes)).equals(changesBefore)).toBe(true);
    expect((await readdir(p.imageDir)).filter((e) => e.includes('.cuisctl-reset-'))).toEqual([]);
    expect(await snapshotTree(p.files)).toEqual(filesBefore);
  }, 20000);

  it('removes leftover reset temps from an interrupted reset', async () => {
    // Given
    await createInstance({ home, name: 'demo' });
    const p = instancePaths(home, 'demo');
    await writeFile(path.join(p.imageDir, 'Cuis7.8.image.cuisctl-reset-999999'), 'leftover image');
    await writeFile(path.join(p.imageDir, 'Cuis7.8.changes.cuisctl-reset-999999'), 'leftover changes');

    // When
    await resetImage(home, 'demo');

    // Then
    expect((await readdir(p.imageDir)).filter((e) => e.includes('.cuisctl-reset-'))).toEqual([]);
  }, 20000);
});

describe('removeInstance', () => {
  let archiveDir: string;
  let sha256: string;
  let server: ArchiveServer;
  let home: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    archiveDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-archive-'));
    const zip = path.join(archiveDir, 'cuis.zip');
    ({ sha256 } = await buildFakeArchive(zip));
    server = await startArchiveServer(zip, { behavior: 'ok' });
  }, 20000);

  afterAll(async () => {
    await server.close();
    await rm(archiveDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    ({ home, cleanup } = await makeTempHome());
    await ensureHome({ home, archiveUrl: server.url, archiveSha256: sha256 }, () => {});
  }, 20000);

  afterEach(async () => {
    await cleanup();
  });

  it('deletes the instance folder, leaves no staging, and never touches shared cuis/ or symlinked outside folders', async () => {
    // Given
    await createInstance({ home, name: 'demo' });
    const p = instancePaths(home, 'demo');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-outside-'));
    try {
      await writeFile(path.join(outside, 'keep.txt'), 'user data');
      await symlink(outside, path.join(p.files, 'link'));
      const cuisBefore = await snapshotTree(path.join(home, 'cuis'));
      const outsideBefore = await snapshotTree(outside);

      // When
      await removeInstance(home, 'demo');

      // Then
      await expect(access(p.dir)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readdir(stagingDir(home))).toEqual([]);
      expect(await snapshotTree(path.join(home, 'cuis'))).toEqual(cuisBefore);
      expect(await snapshotTree(outside)).toEqual(outsideBefore);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 20000);
});
