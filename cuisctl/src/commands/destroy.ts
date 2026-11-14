/**
 * The cuisctl `destroy` command.
 *
 * Flow:
 *  1. Read the instance record (validating the name).
 *  2. Require the instance to be stopped (instance_running).
 *  3. Without --yes: refuse (confirmation_required).
 *  4. Under the per-instance lock, recheck it is stopped and remove the instance folder.
 *  5. Report the DestroyView with the removed instance folder and its files folder.
 *
 * No version check on purpose: an instance with a mismatched version must stay removable.
 */
import { CuisctlError } from '../errors.js';
import { readInstance, removeInstance } from '../instance.js';
import type { Result } from '../output.js';
import { instancePaths } from '../paths.js';
import { requireStopped } from '../state.js';
import { errorResult } from './errorResult.js';
import { withInstanceLock } from './instanceLock.js';

export interface DestroyOptions {
  home: string;
  name: string;
  yes?: boolean;
}

export interface DestroyView {
  name: string;
  removed: { instance: string; files: string };
}

/** Runs the destroy flow; never rejects, failures are returned as an error Result. */
export async function runDestroy(opts: DestroyOptions): Promise<Result> {
  try {
    await readInstance(opts.home, opts.name);
    await requireStopped(opts.home, opts.name);
    const paths = instancePaths(opts.home, opts.name);
    if (opts.yes !== true) {
      throw new CuisctlError(
        'confirmation_required',
        `destroy would delete ${paths.dir}, including its user files in ${paths.files}`,
        `cuisctl destroy ${opts.name} --yes`,
      );
    }
    return await withInstanceLock(opts.home, opts.name, async (): Promise<Result> => {
      await requireStopped(opts.home, opts.name);
      await removeInstance(opts.home, opts.name);
      return {
        ok: true,
        command: 'destroy',
        data: { name: opts.name, removed: { instance: paths.dir, files: paths.files } } satisfies DestroyView,
      };
    });
  } catch (e) {
    return errorResult(e);
  }
}
