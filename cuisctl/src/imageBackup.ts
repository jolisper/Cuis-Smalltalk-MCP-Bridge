/**
 * Image backup helpers: copies an instance's image and changes files into its run backup directory.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InstancePaths } from './paths.js';

export async function backupImage(paths: InstancePaths): Promise<void> {
  await fs.mkdir(paths.runBackup, { recursive: true });
  for (const file of [paths.image, paths.changes]) {
    await fs.copyFile(file, path.join(paths.runBackup, path.basename(file)));
  }
}

export async function restoreImage(paths: InstancePaths): Promise<void> {
  for (const file of [paths.image, paths.changes]) {
    const temp = `${file}.restore-${process.pid}`;
    try {
      await fs.copyFile(path.join(paths.runBackup, path.basename(file)), temp);
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }
}
