import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function makeWritable(p: string): Promise<void> {
  const st = await fs.lstat(p).catch(() => undefined);
  if (!st || st.isSymbolicLink()) return;
  await fs.chmod(p, st.isDirectory() ? 0o755 : 0o644).catch(() => {});
  if (st.isDirectory()) {
    for (const name of await fs.readdir(p)) await makeWritable(path.join(p, name));
  }
}

export async function makeTempHome(): Promise<{ home: string; cleanup(): Promise<void> }> {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cuisctl-home-test-')));
  return {
    home,
    async cleanup() {
      await makeWritable(home);
      await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
