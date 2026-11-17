import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupImage, restoreImage } from './imageBackup.js';
import { instancePaths } from './paths.js';
import { makeTempHome } from './testSupport/tempHome.js';

describe('cuisctl imageBackup', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('copies the image and changes files into the run backup directory', async () => {
    // Given
    const temp = await makeTempHome();
    cleanup = temp.cleanup;
    const paths = instancePaths(temp.home, 'demo');
    const imageBytes = Buffer.from([1, 2, 3, 255]);
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, imageBytes);
    await fs.writeFile(paths.changes, 'changes text');

    // When
    await backupImage(paths);

    // Then
    const backedImage = await fs.readFile(path.join(paths.runBackup, path.basename(paths.image)));
    const backedChanges = await fs.readFile(
      path.join(paths.runBackup, path.basename(paths.changes)),
      'utf8',
    );
    expect(backedImage.equals(imageBytes)).toBe(true);
    expect(backedChanges).toBe('changes text');
  });

  it('restores the live image and changes files from the run backup directory', async () => {
    // Given
    const temp = await makeTempHome();
    cleanup = temp.cleanup;
    const paths = instancePaths(temp.home, 'demo');
    const imageBytes = Buffer.from([1, 2, 3, 255]);
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, imageBytes);
    await fs.writeFile(paths.changes, 'changes text');
    await backupImage(paths);
    await fs.writeFile(paths.image, Buffer.from([9, 9, 9]));
    await fs.writeFile(paths.changes, 'modified changes');

    // When
    await restoreImage(paths);

    // Then
    const restoredImage = await fs.readFile(paths.image);
    const restoredChanges = await fs.readFile(paths.changes, 'utf8');
    expect(restoredImage.equals(imageBytes)).toBe(true);
    expect(restoredChanges).toBe('changes text');
  });

  it('restores live files atomically by renaming over them and leaves no temp files behind', async () => {
    // Given
    const temp = await makeTempHome();
    cleanup = temp.cleanup;
    const paths = instancePaths(temp.home, 'demo');
    await fs.mkdir(paths.imageDir, { recursive: true });
    await fs.writeFile(paths.image, 'original');
    await fs.writeFile(paths.changes, 'changes text');
    await backupImage(paths);
    await fs.writeFile(paths.image, 'modified');
    const alias = path.join(temp.home, 'alias-image');
    await fs.link(paths.image, alias);

    // When
    await restoreImage(paths);

    // Then
    expect(await fs.readFile(paths.image, 'utf8')).toBe('original');
    expect(await fs.readFile(alias, 'utf8')).toBe('modified');
    const entries = await fs.readdir(paths.imageDir);
    expect(entries.sort()).toEqual([path.basename(paths.image), path.basename(paths.changes)].sort());
  });
});
