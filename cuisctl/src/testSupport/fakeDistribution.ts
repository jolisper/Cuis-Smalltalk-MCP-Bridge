import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CUIS_ARCHIVE_TOP_DIR,
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_DIR,
  CUIS_IMAGE_FILE,
  CUIS_SOURCES_FILE,
  CUIS_VM_PATH,
} from '../pin.js';
import { writeFakeVm } from './fakeVm.js';

const execFileP = promisify(execFile);

export async function buildFakeArchive(
  destZip: string,
  opts: {
    bootFails?: boolean;
    requireRealVmScript?: boolean;
    writesUserChanges?: boolean;
    invocationLog?: string;
  } = {},
): Promise<{ sha256: string }> {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'cuis-archive-stage-'));
  try {
    const top = path.join(stage, CUIS_ARCHIVE_TOP_DIR);
    const imageDir = path.join(top, CUIS_IMAGE_DIR);
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, CUIS_IMAGE_FILE), 'fake image\n');
    await fs.writeFile(path.join(imageDir, CUIS_SOURCES_FILE), 'fake sources\n');
    await fs.writeFile(path.join(imageDir, CUIS_CHANGES_FILE), 'fake changes\n');
    await fs.mkdir(path.join(top, 'Packages', 'Features'), { recursive: true });
    await fs.writeFile(path.join(top, 'Packages', 'marker.txt'), 'marker\n');
    await fs.writeFile(path.join(top, 'Packages', 'Features', 'JSON.pck.st'), "'fake JSON package'\n");
    await fs.mkdir(path.join(top, 'CoreUpdates'), { recursive: true });
    await fs.writeFile(path.join(top, 'CoreUpdates', 'README.txt'), 'fake core updates\n');
    const vmPath = path.join(top, CUIS_VM_PATH);
    await fs.mkdir(path.dirname(vmPath), { recursive: true });
    await writeFakeVm(vmPath, opts);

    await fs.rm(destZip, { force: true });
    await execFileP('zip', ['-q', '-r', path.resolve(destZip), CUIS_ARCHIVE_TOP_DIR], { cwd: stage });
    const sha256 = createHash('sha256').update(await fs.readFile(destZip)).digest('hex');
    return { sha256 };
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
