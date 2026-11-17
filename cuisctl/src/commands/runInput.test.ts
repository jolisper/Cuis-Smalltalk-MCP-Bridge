import { describe, expect, it, vi } from 'vitest';
import { CuisctlError } from '../errors.js';
import { resolveRunInput, type RunInputDeps } from './runInput.js';

describe('resolveRunInput', () => {
  it('resolves inline code with the default 60 second timeout without reading stdin or files', async () => {
    // Given deps that throw if stdin or a file is read
    const deps: RunInputDeps = {
      readStdin: async () => {
        throw new Error('readStdin must not be called');
      },
      readFile: async () => {
        throw new Error('readFile must not be called');
      },
    };

    // When resolving input with inline code only
    const result = await resolveRunInput({ code: '3 + 4' }, deps);

    // Then the code is returned as-is with the default timeout
    expect(result).toEqual({ code: '3 + 4', timeoutSeconds: 60 });
  });

  it('rejects with a usage error when no code, file or stdin is given', async () => {
    // Given deps that throw if stdin or a file is read
    const deps: RunInputDeps = {
      readStdin: async () => {
        throw new Error('readStdin must not be called');
      },
      readFile: async () => {
        throw new Error('readFile must not be called');
      },
    };

    // When resolving input with no code source
    const promise = resolveRunInput({}, deps);

    // Then it rejects with a CuisctlError of kind usage naming the missing sources
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(/code|--file|--stdin/),
    });
  });

  it('reads the code from the given file with the default timeout without reading stdin', async () => {
    // Given a readFile stub that only knows prog.st and a readStdin that throws
    const deps: RunInputDeps = {
      readStdin: async () => {
        throw new Error('readStdin must not be called');
      },
      readFile: async (path: string) => {
        if (path === 'prog.st') return 'Transcript show: 1';
        throw new Error(`unexpected readFile path: ${path}`);
      },
    };

    // When resolving input with a file option
    const result = await resolveRunInput({ file: 'prog.st' }, deps);

    // Then the file contents are returned as the code with the default timeout
    expect(result).toEqual({ code: 'Transcript show: 1', timeoutSeconds: 60 });
  });

  it('reads the code from stdin with the default timeout without reading files', async () => {
    // Given a readStdin that yields piped text and a readFile that throws
    const deps: RunInputDeps = {
      readStdin: async () => ({ text: '3 + 4', isTTY: false }),
      readFile: async () => {
        throw new Error('readFile must not be called');
      },
    };

    // When resolving input with the stdin option
    const result = await resolveRunInput({ stdin: true }, deps);

    // Then the stdin text is returned as the code with the default timeout
    expect(result).toEqual({ code: '3 + 4', timeoutSeconds: 60 });
  });

  it('rejects with a usage error when stdin is an interactive terminal', async () => {
    // Given a readStdin that reports a TTY and a readFile that throws
    const deps: RunInputDeps = {
      readStdin: async () => ({ text: '3 + 4', isTTY: true }),
      readFile: async () => {
        throw new Error('readFile must not be called');
      },
    };

    // When resolving input with the stdin option
    const promise = resolveRunInput({ stdin: true }, deps);

    // Then it rejects with a CuisctlError of kind usage mentioning stdin and the terminal
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(/stdin.*(terminal|tty)|(terminal|tty).*stdin/i),
    });
  });

  it.each([
    ['inline code', { code: '   ' }],
    ['a file', { file: 'a.st' }],
    ['stdin', { stdin: true }],
  ])('rejects with a usage error when the code from %s is empty or only whitespace', async (_source, opts) => {
    // Given deps whose file and stdin yield blank text
    const deps: RunInputDeps = {
      readStdin: async () => ({ text: '', isTTY: false }),
      readFile: async () => '  \n\t ',
    };

    // When resolving input with a blank code source
    const promise = resolveRunInput(opts, deps);

    // Then it rejects with a CuisctlError of kind usage saying the code is empty or blank
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(/empty|blank/i),
    });
  });

  it.each([
    ['code and file', { code: '1', file: 'a.st' }],
    ['code and stdin', { code: '1', stdin: true }],
    ['file and stdin', { file: 'a.st', stdin: true }],
  ])('rejects with a usage error without reading anything when given %s', async (_sources, opts) => {
    // Given spy deps that must never be called
    const readStdin = vi.fn(async () => ({ text: '1', isTTY: false }));
    const readFile = vi.fn(async () => '1');
    const deps: RunInputDeps = { readStdin, readFile };

    // When resolving input with more than one code source
    const promise = resolveRunInput(opts, deps);

    // Then it rejects with a usage error saying only one source is allowed
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(/only one|exactly one|more than one/i),
    });
    // And neither stdin nor the file was read
    expect(readStdin).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['--save and --detach', { stdin: true, save: true, detach: true }, /--save.*--detach/],
    ['--headless and --gui', { stdin: true, headless: true, gui: true }, /--headless.*--gui/],
  ])('rejects with a usage error without reading stdin when given conflicting options %s', async (_flags, opts, pattern) => {
    // Given spy deps that must never be called
    const readStdin = vi.fn(async () => ({ text: '1', isTTY: false }));
    const readFile = vi.fn(async () => '1');
    const deps: RunInputDeps = { readStdin, readFile };

    // When resolving input with mutually exclusive options
    const promise = resolveRunInput(opts, deps);

    // Then it rejects with a usage error naming both conflicting options
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringMatching(pattern),
    });
    // And neither stdin nor the file was read
    expect(readStdin).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['5', 5],
    ['300', 300],
  ])('resolves the timeout option %j to %i seconds', async (timeout, expectedSeconds) => {
    // Given deps that throw if stdin or a file is read
    const deps: RunInputDeps = {
      readStdin: async () => {
        throw new Error('readStdin must not be called');
      },
      readFile: async () => {
        throw new Error('readFile must not be called');
      },
    };

    // When resolving input with inline code and a timeout string
    const result = await resolveRunInput({ code: '1', timeout }, deps);

    // Then the timeout is returned as a number of seconds
    expect(result).toEqual({ code: '1', timeoutSeconds: expectedSeconds });
  });

  it.each(['0', '-1', 'abc', '1.5', '301', '', ' 5'])(
    'rejects with a usage error mentioning --timeout for the invalid timeout %j',
    async (timeout) => {
      // Given deps that throw if stdin or a file is read
      const deps: RunInputDeps = {
        readStdin: async () => {
          throw new Error('readStdin must not be called');
        },
        readFile: async () => {
          throw new Error('readFile must not be called');
        },
      };

      // When resolving input with inline code and an invalid timeout string
      const promise = resolveRunInput({ code: '1', timeout }, deps);

      // Then it rejects with a CuisctlError of kind usage mentioning --timeout
      await expect(promise).rejects.toBeInstanceOf(CuisctlError);
      await expect(promise).rejects.toMatchObject({
        kind: 'usage',
        message: expect.stringContaining('--timeout'),
      });
    },
  );

  it('rejects with a usage error naming the file when the file cannot be read', async () => {
    // Given a readFile that rejects with a raw ENOENT error
    const deps: RunInputDeps = {
      readStdin: async () => {
        throw new Error('readStdin must not be called');
      },
      readFile: async () => {
        throw new Error('ENOENT: no such file');
      },
    };

    // When resolving input with a file that does not exist
    const promise = resolveRunInput({ file: 'missing.st' }, deps);

    // Then it rejects with a CuisctlError of kind usage (not the raw error) naming the file
    await expect(promise).rejects.toBeInstanceOf(CuisctlError);
    await expect(promise).rejects.toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('missing.st'),
    });
  });
});
