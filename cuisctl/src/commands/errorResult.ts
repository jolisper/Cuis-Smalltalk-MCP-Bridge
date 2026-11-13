import { CuisctlError } from '../errors.js';
import type { Result } from '../output.js';

/**
 * Converts anything thrown by a command into an error Result.
 * CuisctlError keeps its kind, message and (when present) hint; anything else
 * becomes an internal_error.
 */
export function errorResult(err: unknown): Result {
  if (err instanceof CuisctlError) {
    return {
      ok: false,
      error:
        err.hint === undefined
          ? { kind: err.kind, message: err.message }
          : { kind: err.kind, message: err.message, hint: err.hint },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { kind: 'internal_error', message } };
}
