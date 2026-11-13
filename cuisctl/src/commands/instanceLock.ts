import fs from 'node:fs/promises';
import { CuisctlError } from '../errors.js';
import { acquireLock, releaseLock } from '../lock.js';
import { instanceLockFile, locksDir } from '../paths.js';

export async function withInstanceLock<T>(
  home: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  await fs.mkdir(locksDir(home), { recursive: true });
  const lockFile = instanceLockFile(home, name);
  if (!(await acquireLock(lockFile))) {
    throw new CuisctlError('busy', `another cuisctl command is changing ${name}`);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lockFile);
  }
}
