/**
 * Errors raised by cuisctl.
 *
 * Every failure cuisctl reports is a `CuisctlError` tagged with a machine-readable
 * `ErrorKind`, so callers can branch on the kind rather than parse the message.
 */

export type ErrorKind =
  | 'usage'
  | 'invalid_name'
  | 'already_exists'
  | 'not_found'
  | 'unsupported_platform'
  | 'cuis_fetch_failed'
  | 'cuis_checksum_mismatch'
  | 'cuis_write_failed'
  | 'cuis_base_build_failed'
  | 'cuis_corrupt'
  | 'busy'
  | 'instance_running'
  | 'port_in_use'
  | 'start_failed'
  | 'version_mismatch'
  | 'not_saved'
  | 'confirmation_required'
  | 'home_not_ready'
  | 'internal_error';

export class CuisctlError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    /** The command that resolves the error, when one exists. */
    readonly hint?: string,
  ) {
    super(message);
  }
}
