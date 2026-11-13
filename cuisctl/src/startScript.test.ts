import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bridgePackageFile, buildStartScript, signalTrapPackageFile } from './startScript.js';

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
