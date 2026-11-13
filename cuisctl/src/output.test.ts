import { describe, expect, it } from 'vitest';
import { exitCode, renderJson, renderText } from './output.js';

describe('exitCode', () => {
  it('is 0 for a successful result', () => {
    // Given
    const result = { ok: true, command: 'status', data: [] } as const;

    // When
    const code = exitCode(result);

    // Then
    expect(code).toBe(0);
  });

  it('is 1 for a command error', () => {
    // Given
    const result = {
      ok: false,
      error: { kind: 'not_found', message: 'no instance named demo' },
    } as const;

    // When
    const code = exitCode(result);

    // Then
    expect(code).toBe(1);
  });

  it('is 2 for a usage error', () => {
    // Given
    const result = {
      ok: false,
      error: { kind: 'usage', message: 'unknown command: frob' },
    } as const;

    // When
    const code = exitCode(result);

    // Then
    expect(code).toBe(2);
  });
});

describe('renderJson', () => {
  it('renders a success result as one compact JSON line with a trailing newline', () => {
    // Given
    const result = { ok: true, command: 'status', data: [] } as const;

    // When
    const text = renderJson(result);

    // Then
    expect(text).toBe('{"ok":true,"command":"status","data":[]}\n');
  });
});

describe('renderText', () => {
  it('renders an error without a hint as a single "error:" line', () => {
    // Given
    const result = {
      ok: false,
      error: { kind: 'not_found', message: 'no instance named demo' },
    } as const;

    // When
    const text = renderText(result);

    // Then
    expect(text).toBe('error: no instance named demo\n');
  });

  it('renders an error with a hint as an "error:" line followed by a "hint:" line', () => {
    // Given
    const result = {
      ok: false,
      error: {
        kind: 'not_found',
        message: 'no instance named demo',
        hint: 'cuisctl create demo',
      },
    } as const;

    // When
    const text = renderText(result);

    // Then
    expect(text).toBe('error: no instance named demo\nhint: cuisctl create demo\n');
  });

  it('renders a create result as a "Created instance" summary with state and paths', () => {
    // Given
    const result = {
      ok: true,
      command: 'create',
      data: {
        name: 'demo',
        cuisKey: '7.8-d4f9cc1',
        createdAt: '2026-11-12T10:00:00.000Z',
        state: 'stopped',
        paths: {
          instance: '/h/instances/demo',
          files: '/h/instances/demo/files',
          log: '/h/instances/demo/vm.log',
        },
      },
    } as const;

    // When
    const text = renderText(result);

    // Then
    expect(text).toBe(
      [
        'Created instance demo (Cuis 7.8-d4f9cc1)',
        '  state:  stopped',
        '  folder: /h/instances/demo',
        '  files:  /h/instances/demo/files',
        '  log:    /h/instances/demo/vm.log',
        '',
      ].join('\n'),
    );
  });

  it('renders a status result for one instance with state, runtime details and paths', () => {
    // Given
    const paths = {
      instance: '/h/instances/demo',
      files: '/h/instances/demo/files',
      log: '/h/instances/demo/vm.log',
    };
    const base = {
      name: 'demo',
      cuisKey: '7.8-d4f9cc1',
      createdAt: '2026-11-12T10:00:00.000Z',
      paths,
    };
    const stopped = { ok: true, command: 'status', data: { ...base, state: 'stopped' } } as const;
    const running = {
      ok: true,
      command: 'status',
      data: {
        ...base,
        state: 'running',
        pid: 4242,
        mode: 'gui',
        bridge: true,
        saveOnStop: false,
        startedAt: '2026-11-12T10:30:00.000Z',
      },
    } as const;
    const untracked = {
      ok: true,
      command: 'status',
      data: { ...base, state: 'running_untracked', pid: 4242 },
    } as const;

    // When
    const stoppedText = renderText(stopped);
    const runningText = renderText(running);
    const untrackedText = renderText(untracked);

    // Then
    expect(stoppedText).toBe(
      [
        'demo: stopped (Cuis 7.8-d4f9cc1)',
        '  folder: /h/instances/demo',
        '  files:  /h/instances/demo/files',
        '  log:    /h/instances/demo/vm.log',
        '',
      ].join('\n'),
    );
    expect(runningText).toBe(
      [
        'demo: running (Cuis 7.8-d4f9cc1)',
        '  pid:    4242',
        '  mode:   gui',
        '  bridge: on',
        '  save on stop: unavailable',
        '  started: 2026-11-12T10:30:00.000Z',
        '  folder: /h/instances/demo',
        '  files:  /h/instances/demo/files',
        '  log:    /h/instances/demo/vm.log',
        '',
      ].join('\n'),
    );
    expect(untrackedText).toBe(
      [
        'demo: running (untracked) (Cuis 7.8-d4f9cc1)',
        '  pid:    4242',
        '  folder: /h/instances/demo',
        '  files:  /h/instances/demo/files',
        '  log:    /h/instances/demo/vm.log',
        '',
      ].join('\n'),
    );
  });

  it('renders a start result as "running" or "already running" followed by runtime details and paths', () => {
    // Given
    const view = {
      name: 'demo',
      cuisKey: '7.8-d4f9cc1',
      createdAt: '2026-01-01T00:00:00.000Z',
      paths: {
        instance: '/h/instances/demo',
        files: '/h/instances/demo/files',
        log: '/h/instances/demo/vm.log',
      },
      state: 'running',
      pid: 4242,
      mode: 'headless',
      bridge: true,
      saveOnStop: true,
      startedAt: '2026-01-01T00:00:00.000Z',
    } as const;
    const fresh = {
      ok: true,
      command: 'start',
      data: { ...view, alreadyRunning: false },
    } as const;
    const again = {
      ok: true,
      command: 'start',
      data: { ...view, alreadyRunning: true },
    } as const;
    const details = [
      '  pid:    4242',
      '  mode:   headless',
      '  bridge: on',
      '  save on stop: available',
      '  started: 2026-01-01T00:00:00.000Z',
      '  folder: /h/instances/demo',
      '  files:  /h/instances/demo/files',
      '  log:    /h/instances/demo/vm.log',
      '',
    ];

    // When
    const freshText = renderText(fresh);
    const againText = renderText(again);

    // Then
    expect(freshText).toBe(['demo: running', ...details].join('\n'));
    expect(againText).toBe(['demo: already running', ...details].join('\n'));
  });

  it('renders a stop result as "stopped, saved", "stopped, not saved" or "already stopped"', () => {
    // Given
    const saved = {
      ok: true,
      command: 'stop',
      data: { name: 'demo', outcome: 'stopped', saved: true },
    } as const;
    const notSaved = {
      ok: true,
      command: 'stop',
      data: { name: 'demo', outcome: 'stopped', saved: false },
    } as const;
    const already = {
      ok: true,
      command: 'stop',
      data: { name: 'demo', outcome: 'already_stopped', saved: false },
    } as const;

    // When
    const savedText = renderText(saved);
    const notSavedText = renderText(notSaved);
    const alreadyText = renderText(already);

    // Then
    expect(savedText).toBe('demo: stopped, saved\n');
    expect(notSavedText).toBe('demo: stopped, not saved\n');
    expect(alreadyText).toBe('demo: already stopped\n');
  });

  it('renders a reset result as a "reset to the pristine base" line followed by paths', () => {
    // Given
    const result = {
      ok: true,
      command: 'reset',
      data: {
        name: 'demo',
        cuisKey: '7.8-abc',
        createdAt: '2026-01-01T00:00:00.000Z',
        state: 'stopped',
        paths: {
          instance: '/h/instances/demo',
          files: '/h/instances/demo/files',
          log: '/h/instances/demo/vm.log',
        },
      },
    } as const;

    // When
    const text = renderText(result);

    // Then
    expect(text).toBe(
      [
        'demo: reset to the pristine base (Cuis 7.8-abc); user files kept',
        '  folder: /h/instances/demo',
        '  files:  /h/instances/demo/files',
        '  log:    /h/instances/demo/vm.log',
        '',
      ].join('\n'),
    );
  });

  it('renders a destroy result as a "destroyed" line naming the removed folder', () => {
    // Given
    const result = {
      ok: true,
      command: 'destroy',
      data: {
        name: 'demo',
        removed: { instance: '/h/instances/demo', files: '/h/instances/demo/files' },
      },
    } as const;

    // When
    const text = renderText(result);

    // Then
    expect(text).toBe('demo: destroyed (removed /h/instances/demo, including its user files)\n');
  });

  it('renders a status list with a "Cuis home:" header and one aligned line per instance', () => {
    // Given
    const base = {
      cuisKey: '7.8-d4f9cc1',
      createdAt: '2026-01-01T00:00:00.000Z',
      paths: { instance: '/i', files: '/f', log: '/l' },
    };
    const empty = {
      ok: true,
      command: 'status',
      data: { home: { state: 'missing' }, instances: [] },
    } as const;
    const ready = {
      ok: true,
      command: 'status',
      data: {
        home: { state: 'ready' },
        instances: [
          { ...base, name: 'alpha', state: 'stopped' },
          {
            ...base,
            name: 'beta',
            state: 'running',
            pid: 4242,
            mode: 'gui',
            bridge: false,
            saveOnStop: false,
            startedAt: '2026-01-01T00:00:00.000Z',
          },
          { ...base, name: 'gamma', state: 'running_untracked', pid: 99 },
        ],
      },
    } as const;
    const failed = {
      ok: true,
      command: 'status',
      data: {
        home: {
          state: 'failed',
          error: { kind: 'cuis_fetch_failed', message: 'could not download' },
        },
        instances: [{ ...base, name: 'demo', state: 'stopped' }],
      },
    } as const;

    // When
    const emptyText = renderText(empty);
    const readyText = renderText(ready);
    const failedText = renderText(failed);

    // Then
    expect(emptyText).toBe('Cuis home: missing\nNo instances.\n');
    expect(readyText).toBe(
      [
        'Cuis home: ready',
        'alpha  stopped',
        'beta   running (pid 4242)',
        'gamma  running (untracked, pid 99)',
        '',
      ].join('\n'),
    );
    expect(failedText).toBe(
      [
        'Cuis home: failed (cuis_fetch_failed: could not download)',
        'demo  stopped',
        '',
      ].join('\n'),
    );
  });
});
