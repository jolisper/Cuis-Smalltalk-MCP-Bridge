/**
 * `cuisctl create` command logic.
 *
 * Flow: validate name -> check the instance does not already exist ->
 * ensureHome -> createInstance.
 */
import { stat } from 'node:fs/promises';
import { definedOnly } from '../definedOnly.js';
import { instanceDir } from '../paths.js';
import { errorResult } from './errorResult.js';
import { ensureHome } from '../home.js';
import { alreadyExistsError, createInstance, validateName } from '../instance.js';
import { stoppedView } from './status.js';
import type { Result } from '../output.js';

export interface CreateOptions {
  home: string;
  name: string;
  onProgress: (message: string) => void;
  archiveUrl?: string;
  archiveSha256?: string;
  unzip?: string;
  smokeTimeoutMs?: number;
  pollIntervalMs?: number;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Runs the create flow; never rejects, failures are returned as an error Result. */
export async function runCreate(opts: CreateOptions): Promise<Result> {
  try {
    validateName(opts.name);
    const { home, name, onProgress, ...rest } = opts;
    if (await exists(instanceDir(home, name))) {
      throw alreadyExistsError(name);
    }
    await ensureHome({ home, ...definedOnly(rest) }, onProgress);
    const record = await createInstance({ home, name });
    return { ok: true, command: 'create', data: stoppedView(home, record) };
  } catch (e) {
    return errorResult(e);
  }
}
