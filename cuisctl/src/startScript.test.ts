import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bridgePackageFile, buildRunScript, buildStartScript, signalTrapPackageFile } from './startScript.js';

describe('cuisctl startScript', () => {
  it('without bridge, puts temps on line 1 and ready/port markers on line 2', () => {
    // Given
    const options = { readyFile: '/tmp/r/ready', signalTrapPackage: '/x/SignalTrap.pck.st' };

    // When
    const lines = buildStartScript(options).split('\n');

    // Then
    expect(lines[0]).toBe('| author initials |');
    expect(lines[1]).toContain('"cuisctl-ready: /tmp/r/ready"');
    expect(lines[1]).toContain('"cuisctl-bridge-port: none"');
  });

  it('installs the SignalTrap package only when the class is absent, escaping quotes in the path', () => {
    // Given
    const options = { readyFile: '/tmp/r/ready', signalTrapPackage: "/x/it's/SignalTrap.pck.st" };

    // When
    const script = buildStartScript(options).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain(
      "(Smalltalk includesKey: #SignalTrap) ifFalse: [ CodePackageFile installPackage: '/x/it''s/SignalTrap.pck.st' asFullFileEntry",
    );
  });

  it('writes the ready file last, recording the trap armed state, escaping quotes in the path', () => {
    // Given
    const options = { readyFile: "/tmp/r/it's ready", signalTrapPackage: '/x/SignalTrap.pck.st' };
    const readyLine =
      "'/tmp/r/it''s ready' asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'armed='; print: (Smalltalk at: #SignalTrap) isArmed ]";

    // When
    const script = buildStartScript(options).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain(readyLine);
    expect(script.indexOf(readyLine)).toBeGreaterThan(script.indexOf('installPackage:'));
  });

  it('sets the author to cuisctl around the load and restores the previous author before the ready file', () => {
    // Given
    const options = { readyFile: '/tmp/r/ready', signalTrapPackage: '/x/SignalTrap.pck.st' };
    const expectedInOrder = [
      'author := Utilities classPool at: #AuthorName.',
      'initials := Utilities authorInitialsPerSe.',
      "Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.",
      'installPackage:',
      'Utilities setAuthorName: author initials: initials.',
      'forceWriteStreamDo:',
    ];

    // When
    const script = buildStartScript(options).replace(/\s+/g, ' ');

    // Then
    const positions = expectedInOrder.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('with bridge, loads it only if absent then restarts the server on the port, between the trap load and author restore', () => {
    // Given
    const options = {
      readyFile: '/r/ready',
      signalTrapPackage: '/t/SignalTrap.pck.st',
      bridge: { packageFile: "/b/it's/MCP-Bridge.pck.st", port: 6789 },
    };
    const trapLoad = "CodePackageFile installPackage: '/t/SignalTrap.pck.st'";
    const bridgeLoad =
      "(Smalltalk includesKey: #McpBridgeServer) ifFalse: [ CodePackageFile installPackage: '/b/it''s/MCP-Bridge.pck.st' asFullFileEntry ].";
    const startOn = '(Smalltalk at: #McpBridgeServer) stop; startOn: 6789.';
    const expectedInOrder = [
      trapLoad,
      bridgeLoad,
      startOn,
      'Utilities setAuthorName: author initials: initials.',
      'forceWriteStreamDo:',
    ];

    // When
    const script = buildStartScript(options).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain('"cuisctl-bridge-port: 6789"');
    const positions = expectedInOrder.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('without bridge, stops a loaded bridge server without loading it, between the trap load and author restore', () => {
    // Given
    const withoutBridge = { readyFile: '/r/ready', signalTrapPackage: '/t/SignalTrap.pck.st' };
    const withBridge = { ...withoutBridge, bridge: { packageFile: '/b/MCP-Bridge.pck.st', port: 6789 } };
    const guardedStop = '(Smalltalk at: #McpBridgeServer ifAbsent: [ nil ]) ifNotNil: [ :c | c stop ].';

    // When
    const script = buildStartScript(withoutBridge).replace(/\s+/g, ' ');
    const bridgeScript = buildStartScript(withBridge).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain(guardedStop);
    expect(script.indexOf(guardedStop)).toBeGreaterThan(script.indexOf('installPackage:'));
    expect(script.indexOf(guardedStop)).toBeLessThan(
      script.indexOf('Utilities setAuthorName: author initials: initials.'),
    );
    expect(script).not.toContain('startOn:');
    expect(script.split('installPackage:')).toHaveLength(2);
    expect(bridgeScript).not.toContain(guardedStop);
  });

  it('logs to stdout first and wraps the body in an Error handler that quits with code 1', () => {
    // Given
    const options = { readyFile: '/tmp/r/ready', signalTrapPackage: '/x/SignalTrap.pck.st' };
    const logLine = 'Transcript logToStdout: true.';
    const handler =
      "] on: Error do: [ :e | Transcript show: 'cuisctl start failed: ', e messageText; newLine. Smalltalk quitPrimitive: 1 ]";

    // When
    const script = buildStartScript(options).replace(/\s+/g, ' ');

    // Then
    const authorAt = script.indexOf('author := Utilities classPool at: #AuthorName.');
    const readyAt = script.indexOf('forceWriteStreamDo:');
    const firstBracket = script.indexOf('[');
    expect(script.indexOf(logLine)).toBeGreaterThanOrEqual(0);
    expect(script.indexOf(logLine)).toBeLessThan(firstBracket);
    expect(script.lastIndexOf('[', authorAt)).toBeGreaterThan(script.indexOf(logLine));
    expect(script.indexOf(handler)).toBeGreaterThan(readyAt);
    expect(script.trimEnd().endsWith(handler)).toBe(true);
  });

  it('run script puts a temp declaration on line 1 and ready/run-code/run-outcome/run-nonce markers on line 2', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };

    // When
    const lines = buildRunScript(options).split('\n');

    // Then
    expect(lines[0]).toMatch(/^\| [A-Za-z ]+ \|$/);
    expect(lines[1]).toContain('"cuisctl-ready: /tmp/r/ready"');
    expect(lines[1]).toContain('"cuisctl-run-code: /tmp/r/run-code.st"');
    expect(lines[1]).toContain('"cuisctl-run-outcome: /tmp/r/run-outcome"');
    expect(lines[1]).toContain('"cuisctl-run-nonce: n123"');
  });

  it('run script logs to stdout, sets the author around the trap load, restores it, then writes the ready file', () => {
    // Given
    const options = {
      readyFile: "/tmp/r/it's ready",
      signalTrapPackage: "/x/it's/SignalTrap.pck.st",
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      'Transcript logToStdout: true.',
      'author := Utilities classPool at: #AuthorName.',
      "Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.",
      "(Smalltalk includesKey: #SignalTrap) ifFalse: [ CodePackageFile installPackage: '/x/it''s/SignalTrap.pck.st' asFullFileEntry",
      "'/tmp/r/it''s ready' asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'armed='; print: (Smalltalk at: #SignalTrap) isArmed ]",
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    const positions = expectedInOrder.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('run script keeps the author as cuisctl through the evaluation and restores it only after END', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const restore = 'Utilities setAuthorName: author initials: initials.';
    const expectedInOrder = [
      "Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.",
      'forceWriteStreamDo:',
      "'n123 BEGIN'",
      'Compiler new evaluate:',
      "'n123 END'",
      restore,
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(script.slice(positions[0], positions[2])).not.toContain(restore);
  });

  it('run script, after the ready file, shows the BEGIN marker, evaluates the code file under the handled exceptions, then shows END', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: "/tmp/r/it's code.st",
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      'forceWriteStreamDo:',
      "Transcript newLine; show: 'n123 BEGIN'; newLine",
      "'/tmp/r/it''s code.st'",
      'Compiler new evaluate:',
      'on: Error, UnhandledError, Halt, Warning, SyntaxErrorNotification',
      "'n123 END'",
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    const positions = expectedInOrder.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('run script evaluation handler also lists Error so the outer quit handler cannot pre-empt it', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const handler = 'on: Error, UnhandledError, Halt, Warning, SyntaxErrorNotification do: [ :e |';

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    const evaluate = script.indexOf('Compiler new evaluate:');
    const handlerAt = script.indexOf(handler);
    const end = script.indexOf("'n123 END'");
    expect(handlerAt).toBeGreaterThan(evaluate);
    expect(end).toBeGreaterThan(handlerAt);
  });

  it('run script evaluates with the instance-side evaluate:in:to:notifying:ifFail: form, not the one-keyword evaluate:', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain('Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [');
    expect(script).not.toContain('Compiler new evaluate: src ]');
  });

  it('run script, after END, writes the outcome lines to a temp file beside the outcome path then renames it over the outcome path', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: "/tmp/r/it's outcome",
      nonce: 'n123',
    };
    const expectedInOrder = [
      "'n123 END'",
      "'/tmp/r/it''s outcome.tmp'",
      "'status='",
      "'elapsedMs='",
      "'result='",
      "'resultTruncated='",
      "'error='",
      "'done'",
      'rename:',
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    const positions = expectedInOrder.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('run script deletes an existing outcome file between the temp write and the rename', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: "/tmp/r/it's outcome",
      nonce: 'n123',
    };
    const expectedInOrder = [
      "'/tmp/r/it''s outcome.tmp'",
      "'/tmp/r/it''s outcome' asFullFileEntry",
      'exists ifTrue: [',
      'delete',
      'rename:',
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('run script measures elapsed time with Time millisecondClockValue around the evaluation instead of a hardcoded 0', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      "'n123 BEGIN'",
      'Time millisecondClockValue',
      'Compiler new evaluate:',
      'Time millisecondClockValue',
      "'n123 END'",
      "'elapsedMs='",
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(script).not.toContain("'elapsedMs='; nextPutAll: '0'");
  });

  it('run script keeps the printString result and writes a status variable that the handler switches to failed', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      'Compiler new evaluate:',
      'printString',
      'on: Error, UnhandledError, Halt, Warning, SyntaxErrorNotification do: [ :e |',
      'messageText',
      "'failed'",
      "'n123 END'",
      "'status='",
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(script).not.toContain("nextPutAll: 'passed'");
    expect(script).not.toContain("'status='; nextPutAll: 'passed'");
  });

  it('run script captures a nil-safe error text via description and never concatenates messageText in the outer failure handler', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    expect(script).toContain('error := (e messageText ifNil: [ e description ]) asString');
    expect(script).not.toContain('e messageText asString');
    const failedAt = script.indexOf('cuisctl run failed:');
    expect(failedAt).toBeGreaterThanOrEqual(0);
    const outerHandler = script.slice(failedAt);
    expect(outerHandler).toContain('e description');
    expect(outerHandler).not.toContain('e messageText');
  });

  it('run script truncates the printString result over 4096 characters and writes a truncated flag instead of a hardcoded false', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      'printString',
      'size > 4096',
      'copyFrom: 1 to: 4096',
      "'resultTruncated='",
      'truncated',
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(script).not.toContain("'resultTruncated='; nextPutAll: 'false'");
  });

  it('run script escapes backslash, LF and CR in the result and error values through an escape helper block', () => {
    // Given
    const options = {
      readyFile: '/tmp/r/ready',
      signalTrapPackage: '/x/SignalTrap.pck.st',
      codeFile: '/tmp/r/run-code.st',
      outcomeFile: '/tmp/r/run-outcome',
      nonce: 'n123',
    };
    const expectedInOrder = [
      "copyReplaceAll: '\\' with: '\\\\'",
      'Character lf',
      "with: '\\n'",
      'Character cr',
      "with: '\\r'",
      "'result='",
      "'error='",
    ];

    // When
    const script = buildRunScript(options).replace(/\s+/g, ' ');

    // Then
    let from = 0;
    const positions = expectedInOrder.map((s) => {
      const p = script.indexOf(s, from);
      if (p >= 0) from = p + s.length;
      return p;
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(script).toContain('escape value: result');
    expect(script).toContain('escape value: error');
  });

  it('resolves the bridge and SignalTrap package files to existing absolute paths in the checkout', () => {
    // Given / When
    const bridge = bridgePackageFile();
    const trap = signalTrapPackageFile();

    // Then
    expect(path.isAbsolute(bridge)).toBe(true);
    expect(bridge.endsWith('/mcp-bridge/image/MCP-Bridge.pck.st')).toBe(true);
    expect(fs.existsSync(bridge)).toBe(true);
    expect(path.isAbsolute(trap)).toBe(true);
    expect(trap.endsWith('/cuisctl/image/SignalTrap.pck.st')).toBe(true);
    expect(fs.existsSync(trap)).toBe(true);
  });
});
