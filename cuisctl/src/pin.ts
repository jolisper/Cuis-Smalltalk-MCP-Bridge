// cuisctl's own pinned Cuis release (independent of mcp-bridge's pin).
// Bumping the Cuis version means editing this file only.

const CUIS_RELEASE = '7.8';
const CUIS_REPO = 'Cuis-Smalltalk/Cuis7-8';
const CUIS_COMMIT_SHA = 'd4f9cc1243175bd022c1b5dfa6a6a432fb07a035';

// Release archive and its expected checksum.
export const CUIS_ARCHIVE_URL = `https://github.com/${CUIS_REPO}/archive/${CUIS_COMMIT_SHA}.zip`;
export const CUIS_ARCHIVE_SHA256 = 'ffa56eb08112c3167ab2be3748e8deeb2d5329b848bee25945da64a4241c6025';

// Layout key, e.g. "7.8-d4f9cc1": <release>-<short commit SHA>.
export const CUIS_KEY = `${CUIS_RELEASE}-${CUIS_COMMIT_SHA.slice(0, 7)}`;

// Archive contents (paths relative to the archive's top-level directory).
export const CUIS_ARCHIVE_TOP_DIR = `Cuis7-8-${CUIS_COMMIT_SHA}`;
export const CUIS_IMAGE_DIR = 'CuisImage';
export const CUIS_IMAGE_FILE = `Cuis${CUIS_RELEASE}.image`;
export const CUIS_CHANGES_FILE = `Cuis${CUIS_RELEASE}.changes`;
export const CUIS_SOURCES_FILE = `Cuis${CUIS_RELEASE}.sources`;
export const CUIS_VM_PATH = 'CuisVM.app/Contents/MacOS/Squeak';
