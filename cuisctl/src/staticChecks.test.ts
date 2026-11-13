import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(srcDir, '..', 'package.json');

async function collectSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'testSupport') continue;
      files.push(...(await collectSources(full)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('static checks over cuisctl sources', () => {
  it('sources never reference the bridge, force package reloads, or add runtime dependencies', async () => {
    // Given
    const files = await collectSources(srcDir);
    const importSpecifier =
      /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    // When
    const sources = await Promise.all(
      files.map(async (file) => ({ file, text: await readFile(file, 'utf8') })),
    );
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    // Then
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const { file, text } of sources) {
      const forbiddenTexts = ['.cuis-mcp-bridge', 'Cuis7-8-main', 'Feature require'];
      // The start script is the one place allowed to load packages (SignalTrap and the bridge).
      if (path.basename(file) !== 'startScript.ts') forbiddenTexts.push('installPackage');
      for (const forbidden of forbiddenTexts) {
        expect(text.includes(forbidden), `${file} contains "${forbidden}"`).toBe(false);
      }
      for (const match of text.matchAll(importSpecifier)) {
        const specifier = match[1] ?? match[2] ?? '';
        expect(specifier.includes('mcp-bridge'), `${file} imports "${specifier}"`).toBe(false);
      }
    }
    expect(pkg.dependencies, 'package.json has runtime dependencies').toBeUndefined();
    for (const [name, version] of Object.entries({ ...pkg.devDependencies })) {
      expect(version.startsWith('file:'), `dependency ${name} uses ${version}`).toBe(false);
    }
  });

  it('process.kill is only used by processControl.ts and launcher.ts', async () => {
    // Given
    const files = await collectSources(srcDir);
    const allowed = ['processControl.ts', 'launcher.ts'];

    // When
    const offenders: string[] = [];
    for (const file of files) {
      if (allowed.includes(path.basename(file))) continue;
      if ((await readFile(file, 'utf8')).includes('process.kill')) offenders.push(file);
    }

    // Then
    expect(offenders, `files calling process.kill: ${offenders.join(', ')}`).toEqual([]);
  });
});
