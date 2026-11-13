/**
 * The cuisctl `reset` command.
 *
 * Flow:
 *  1. Read the instance record (validating the name) and require the current Cuis version.
 *  2. Under the per-instance lock, require the instance to be stopped.
 *  3. Require a ready home (the pinned base image is present).
 *  4. Restore the image and changes from the pinned base; `files/` is left untouched.
 *  5. Report the stopped InstanceView.
 */
import { requireReadyHome } from '../home.js';
import { readInstance, requireCurrentCuisVersion, resetImage } from '../instance.js';
import type { Result } from '../output.js';
import { requireStopped } from '../state.js';
import { errorResult } from './errorResult.js';
import { withInstanceLock } from './instanceLock.js';
import { stoppedView } from './status.js';

export interface ResetOptions {
  home: string;
  name: string;
  copy?: (src: string, dest: string) => Promise<void>;
}

/** Runs the reset flow; never rejects, failures are returned as an error Result. */
export async function runReset(opts: ResetOptions): Promise<Result> {
  try {
    const record = await readInstance(opts.home, opts.name);
    requireCurrentCuisVersion(record, opts.name);
    return await withInstanceLock(opts.home, opts.name, async (): Promise<Result> => {
      await requireStopped(opts.home, opts.name);
      await requireReadyHome(opts.home, opts.name);
      await resetImage(opts.home, opts.name, opts.copy);
      return { ok: true, command: 'reset', data: stoppedView(opts.home, record) };
    });
  } catch (e) {
    return errorResult(e);
  }
}
