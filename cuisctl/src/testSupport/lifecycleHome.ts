import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCreate } from '../commands/create.js';
import { cuisDistDir, instancePaths } from '../paths.js';
import type { InstancePaths } from '../paths.js';
import { CUIS_KEY, CUIS_VM_PATH } from '../pin.js';
import { pidsHoldingFile } from '../processInfo.js';
import { startArchiveServer } from './archiveServer.js';
import { buildFakeArchive } from './fakeDistribution.js';
import { writeFakeVm } from './fakeVm.js';
import { makeTempHome } from './tempHome.js';

export interface LifecycleHome {
  home: string;
  name: 'demo';
  paths: InstancePaths;
  invocationLog: string;
  vm: string;
  cleanup(): Promise<void>;
}

/**
 * Builds a ready cuisctl home holding one stopped instance named `demo`, whose VM is the
 * long-running fake. `cleanup()` kills any leftover VM process before removing everything.
 */
export async function makeLifecycleHome(): Promise<LifecycleHome> {
  const { home, cleanup: cleanupHome } = await makeTempHome();
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'cuisctl-lifecycle-test-'));
  const { sha256 } = await buildFakeArchive(path.join(stageDir, 'archive.zip'));
  const server = await startArchiveServer(path.join(stageDir, 'archive.zip'));

  const created = await runCreate({
    home,
    name: 'demo',
    onProgress: () => {},
    archiveUrl: server.url,
    archiveSha256: sha256,
  });
  if (!created.ok) throw new Error(`lifecycle home: create failed: ${created.error.message}`);

  const vm = path.join(cuisDistDir(home, CUIS_KEY), CUIS_VM_PATH);
  const invocationLog = path.join(stageDir, 'invocations.log');
  await writeFakeVm(vm, { running: true, invocationLog });

  const paths = instancePaths(home, 'demo');
  return {
    home,
    name: 'demo',
    paths,
    invocationLog,
    vm,
    async cleanup() {
      for (const pid of await pidsHoldingFile(paths.changes).catch(() => [])) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
      await server.close();
      await rm(stageDir, { recursive: true, force: true });
      await cleanupHome();
    },
  };
}
