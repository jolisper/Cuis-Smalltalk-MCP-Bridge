import { describe, expect, it } from 'vitest';
import {
  CUIS_ARCHIVE_SHA256,
  CUIS_ARCHIVE_TOP_DIR,
  CUIS_ARCHIVE_URL,
  CUIS_CHANGES_FILE,
  CUIS_IMAGE_DIR,
  CUIS_IMAGE_FILE,
  CUIS_KEY,
  CUIS_SOURCES_FILE,
  CUIS_VM_PATH,
} from './pin.js';

describe('cuisctl Cuis pin', () => {
  it('reports the pinned version key as 7.8-d4f9cc1', () => {
    // Given / When
    const key = CUIS_KEY;

    // Then
    expect(key).toBe('7.8-d4f9cc1');
  });

  it('pins the archive URL to the Cuis7-8 commit zip', () => {
    // Given / When
    const url = CUIS_ARCHIVE_URL;

    // Then
    expect(url).toBe(
      'https://github.com/Cuis-Smalltalk/Cuis7-8/archive/d4f9cc1243175bd022c1b5dfa6a6a432fb07a035.zip',
    );
  });

  it('pins the archive SHA-256 digest', () => {
    // Given / When
    const sha256 = CUIS_ARCHIVE_SHA256;

    // Then
    expect(sha256).toBe('ffa56eb08112c3167ab2be3748e8deeb2d5329b848bee25945da64a4241c6025');
  });

  it('names the pinned Cuis7.8 image, changes and sources files', () => {
    // Given / When
    const files = [CUIS_IMAGE_FILE, CUIS_CHANGES_FILE, CUIS_SOURCES_FILE];

    // Then
    expect(files).toEqual(['Cuis7.8.image', 'Cuis7.8.changes', 'Cuis7.8.sources']);
  });

  it('describes the archive layout: top dir, image dir and VM path', () => {
    // Given / When
    const layout = [CUIS_ARCHIVE_TOP_DIR, CUIS_IMAGE_DIR, CUIS_VM_PATH];

    // Then
    expect(layout).toEqual([
      'Cuis7-8-d4f9cc1243175bd022c1b5dfa6a6a432fb07a035',
      'CuisImage',
      'CuisVM.app/Contents/MacOS/Squeak',
    ]);
  });
});
