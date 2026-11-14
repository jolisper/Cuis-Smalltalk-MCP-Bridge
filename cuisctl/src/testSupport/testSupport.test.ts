import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CUIS_ARCHIVE_TOP_DIR, CUIS_CHANGES_FILE, CUIS_IMAGE_DIR, CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_VM_PATH } from '../pin.js';
import { startArchiveServer } from './archiveServer.js';
import { buildFakeArchive } from './fakeDistribution.js';
import { fakeShScript, writeFakeVm } from './fakeVm.js';
import { snapshotTree } from './snapshotTree.js';
import { makeTempHome } from './tempHome.js';

const execFileP = promisify(execFile);

function get(url: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

describe('cuisctl test support', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const tmp = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-ts-test-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    return dir;
  };

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it('fake VM runs a fake-sh script and exposes the image path', async () => {
    // Given
    const dir = await tmp();
    const vm = path.join(dir, 'vm');
    await writeFakeVm(vm);
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, fakeShScript('echo "img=$FAKE_IMAGE"; echo "DONE exitCode=0"'));

    // When
    const { stdout } = await execFileP(vm, ['-headless', '/x/a.image', '-s', script]);

    // Then
    expect(stdout).toContain('img=/x/a.image');
    expect(stdout).toContain('DONE exitCode=0');
  });

  it('fake VM exits with the status of a failing fake-sh script', async () => {
    // Given
    const dir = await tmp();
    const vm = path.join(dir, 'vm');
    await writeFakeVm(vm);
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, fakeShScript('exit 7'));

    // When
    const result = execFileP(vm, ['-headless', 'i', '-s', script]);

    // Then
    await expect(result).rejects.toMatchObject({ code: 7 });
  });

  it('fake VM boots a Smalltalk script with the marker, and fails with bootFails', async () => {
    // Given
    const dir = await tmp();
    const ok = path.join(dir, 'ok');
    const bad = path.join(dir, 'bad');
    await writeFakeVm(ok);
    await writeFakeVm(bad, { bootFails: true });
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, "Smalltalk at: #X put: 1.\n");

    // When
    const { stdout } = await execFileP(ok, ['-headless', 'i', '-s', script]);
    const failed = execFileP(bad, ['-headless', 'i', '-s', script]);

    // Then
    expect(stdout).toContain('DONE exitCode=0');
    await expect(failed).rejects.toMatchObject({ code: 3, stderr: expect.stringContaining('cannot boot') });
  });

  it('fake VM ignores trailing args after the script', async () => {
    // Given
    const dir = await tmp();
    const vm = path.join(dir, 'vm');
    await writeFakeVm(vm);
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, fakeShScript('echo "img=$FAKE_IMAGE"'));

    // When
    const { stdout } = await execFileP(vm, ['-headless', '/x/a.image', '-s', script, '-ApplePersistenceIgnoreState', 'YES']);

    // Then
    expect(stdout).toContain('img=/x/a.image');
  });

  it('fake VM with invocationLog appends one line per invocation with argv and cwd', async () => {
    // Given
    const dir = await tmp();
    const cwd = await fs.realpath(await tmp());
    const vm = path.join(dir, 'vm');
    const log = path.join(dir, 'invocations.log');
    await writeFakeVm(vm, { invocationLog: log });
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, "Smalltalk at: #X put: 1.\n");

    // When
    await execFileP(vm, ['-headless', '/x/a.image', '-s', script, '-ApplePersistenceIgnoreState', 'YES'], { cwd });
    await execFileP(vm, ['-headless', '/x/b.image', '-s', script], { cwd });

    // Then
    const lines = (await fs.readFile(log, 'utf8')).trimEnd().split('\n');
    expect(lines).toEqual([
      `argv=${vm} -headless /x/a.image -s ${script} -ApplePersistenceIgnoreState YES cwd=${cwd}`,
      `argv=${vm} -headless /x/b.image -s ${script} cwd=${cwd}`,
    ]);
  });

  it('fake VM without invocationLog writes no log', async () => {
    // Given
    const dir = await tmp();
    const vm = path.join(dir, 'vm');
    await writeFakeVm(vm);

    // Then
    expect(await fs.readFile(vm, 'utf8')).not.toContain('argv=');
  });

  it('buildFakeArchive threads invocationLog to the archived VM', async () => {
    // Given
    const dir = await tmp();
    const zip = path.join(dir, 'a.zip');
    const log = path.join(dir, 'invocations.log');
    await buildFakeArchive(zip, { invocationLog: log });
    const out = path.join(dir, 'out');
    await execFileP('unzip', ['-q', zip, '-d', out]);
    const vm = path.join(out, CUIS_ARCHIVE_TOP_DIR, CUIS_VM_PATH);
    const script = path.join(dir, 's.st');
    await fs.writeFile(script, "Smalltalk at: #X put: 1.\n");

    // When
    await execFileP(vm, ['-headless', 'i', '-s', script]);

    // Then
    expect(await fs.readFile(log, 'utf8')).toContain(`argv=${vm} -headless i -s ${script}`);
  });

  it('buildFakeArchive lists the expected entries and a matching sha256', async () => {
    // Given
    const dir = await tmp();
    const zip = path.join(dir, 'a.zip');

    // When
    const { sha256 } = await buildFakeArchive(zip);

    // Then
    const { stdout } = await execFileP('unzip', ['-l', zip]);
    const top = CUIS_ARCHIVE_TOP_DIR;
    for (const entry of [
      `${top}/${CUIS_IMAGE_DIR}/${CUIS_IMAGE_FILE}`,
      `${top}/${CUIS_IMAGE_DIR}/${CUIS_SOURCES_FILE}`,
      `${top}/${CUIS_IMAGE_DIR}/${CUIS_CHANGES_FILE}`,
      `${top}/${CUIS_VM_PATH}`,
      `${top}/Packages/marker.txt`,
      `${top}/Packages/Features/JSON.pck.st`,
      `${top}/CoreUpdates/README.txt`,
    ]) {
      expect(stdout).toContain(entry);
    }
    const { stdout: shasum } = await execFileP('shasum', ['-a', '256', zip]);
    expect(shasum.split(' ')[0]).toBe(sha256);
  });

  it('archive server serves exact bytes, counts requests, and 404s in not-found mode', async () => {
    // Given
    const dir = await tmp();
    const zip = path.join(dir, 'a.zip');
    await buildFakeArchive(zip);
    const ok = await startArchiveServer(zip);
    const missing = await startArchiveServer(zip, { behavior: 'not-found' });
    cleanups.push(() => ok.close(), () => missing.close());

    // When
    const first = await get(ok.url);
    await get(ok.url);
    const notFound = await get(missing.url);

    // Then
    expect(first.status).toBe(200);
    expect(first.body.equals(await fs.readFile(zip))).toBe(true);
    expect(ok.requestCount()).toBe(2);
    expect(notFound.status).toBe(404);
    expect(missing.requestCount()).toBe(1);
  });

  it('archive server streams exact bytes in several chunks when chunkGapMs is set', async () => {
    // Given
    const dir = await tmp();
    const zip = path.join(dir, 'a.zip');
    await fs.writeFile(zip, Buffer.alloc(1000, 7));
    const server = await startArchiveServer(zip, { chunkSize: 300, chunkGapMs: 5 });
    cleanups.push(() => server.close());
    const chunkSizes: number[] = [];

    // When
    const body = await new Promise<Buffer>((resolve, reject) => {
      http
        .get(server.url, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => {
            chunks.push(c);
            chunkSizes.push(c.length);
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
        })
        .on('error', reject);
    });

    // Then
    expect(body.equals(await fs.readFile(zip))).toBe(true);
    expect(chunkSizes.length).toBeGreaterThan(1);
  });

  it('snapshotTree lists sorted entries with types, symlink targets and file hashes', async () => {
    // Given
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'f.txt'), 'abc');
    await fs.symlink('/nowhere/target', path.join(dir, 'link'));

    // When
    const snapshot = await snapshotTree(dir);

    // Then
    expect(snapshot).toEqual([
      { path: 'link', type: 'symlink', target: '/nowhere/target' },
      { path: 'sub', type: 'directory' },
      {
        path: path.join('sub', 'f.txt'),
        type: 'file',
        size: 3,
        sha256: createHash('sha256').update('abc').digest('hex'),
      },
    ]);
  });

  it('snapshotTree changes when a file changes bytes', async () => {
    // Given
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'f'), 'abc');
    const before = await snapshotTree(dir);

    // When
    await fs.writeFile(path.join(dir, 'f'), 'abd');

    // Then
    expect(await snapshotTree(dir)).not.toEqual(before);
  });

  it('makeTempHome creates the dir and cleanup removes it even when read-only', async () => {
    // Given
    const t = await makeTempHome();
    await fs.mkdir(path.join(t.home, 'ro'));
    await fs.writeFile(path.join(t.home, 'ro', 'f'), 'x');
    await fs.chmod(path.join(t.home, 'ro'), 0o555);
    expect((await fs.stat(t.home)).isDirectory()).toBe(true);

    // When
    await t.cleanup();

    // Then
    await expect(fs.access(t.home)).rejects.toThrow();
  });
});
