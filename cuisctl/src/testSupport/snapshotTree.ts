import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TreeEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  target?: string;
  size?: number;
  sha256?: string;
}

/**
 * Deterministic snapshot of every entry under `dir` (recursive, relative paths, sorted), for
 * before/after equality checks. Symlinks are read, never followed. Rejects when `dir` is missing.
 */
export async function snapshotTree(dir: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  async function walk(rel: string): Promise<void> {
    for (const name of await fs.readdir(path.join(dir, rel))) {
      const relPath = path.join(rel, name);
      const full = path.join(dir, relPath);
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        entries.push({ path: relPath, type: 'symlink', target: await fs.readlink(full) });
      } else if (st.isDirectory()) {
        entries.push({ path: relPath, type: 'directory' });
        await walk(relPath);
      } else {
        const sha256 = createHash('sha256').update(await fs.readFile(full)).digest('hex');
        entries.push({ path: relPath, type: 'file', size: st.size, sha256 });
      }
    }
  }
  await walk('');
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
