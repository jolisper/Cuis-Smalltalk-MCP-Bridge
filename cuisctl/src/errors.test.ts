import { describe, expect, it } from 'vitest';
import { CuisctlError } from './errors.js';

describe('CuisctlError', () => {
  it('is an Error carrying its kind and message', () => {
    // Given
    const kind = 'not_found';
    const message = 'no instance named demo';

    // When
    const error = new CuisctlError(kind, message);

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('not_found');
    expect(error.message).toBe('no instance named demo');
  });

  it('carries an optional hint naming the resolving command', () => {
    // Given
    const kind = 'not_found';
    const message = 'no instance named demo';

    // When
    const withHint = new CuisctlError(kind, message, 'cuisctl create demo');
    const withoutHint = new CuisctlError(kind, message);

    // Then
    expect(withHint.hint).toBe('cuisctl create demo');
    expect(withoutHint.hint).toBeUndefined();
  });
});
