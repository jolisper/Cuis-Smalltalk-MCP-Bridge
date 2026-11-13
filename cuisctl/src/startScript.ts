/**
 * Smalltalk start script builder for `cuisctl start`.
 *
 * Constraints on the emitted script:
 * - Temps are declared on line 1 (`| author initials |`); headless-pitfalls
 *   requires this, otherwise the headless VM misparses the file.
 * - Line 2 carries marker comments (`"cuisctl-ready: ..."`, `"cuisctl-bridge-port: ..."`)
 *   which the fake VM used by the tests (and run records) read back.
 * - `CodePackageFile installPackage:` is allowed in this file only (staticChecks).
 */
import { fileURLToPath } from 'node:url';

export function bridgePackageFile(): string {
  return fileURLToPath(new URL('../../mcp-bridge/image/MCP-Bridge.pck.st', import.meta.url));
}

export function signalTrapPackageFile(): string {
  return fileURLToPath(new URL('../image/SignalTrap.pck.st', import.meta.url));
}

function smalltalkString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildStartScript(opts: {
  readyFile: string;
  signalTrapPackage: string;
  bridge?: { packageFile: string; port: number };
}): string {
  const port = opts.bridge?.port ?? 'none';

  const header = [
    '| author initials |',
    `"cuisctl-ready: ${opts.readyFile}" "cuisctl-bridge-port: ${port}"`,
    'Transcript logToStdout: true.',
  ];

  const bodyStart = [
    '[',
    'author := Utilities classPool at: #AuthorName.',
    'initials := Utilities authorInitialsPerSe.',
    "Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.",
    `(Smalltalk includesKey: #SignalTrap) ifFalse: [ CodePackageFile installPackage: ${smalltalkString(opts.signalTrapPackage)} asFullFileEntry ].`,
  ];

  const bridgeLines = opts.bridge
    ? [
        `(Smalltalk includesKey: #McpBridgeServer) ifFalse: [ CodePackageFile installPackage: ${smalltalkString(opts.bridge.packageFile)} asFullFileEntry ].`,
        `(Smalltalk at: #McpBridgeServer) stop; startOn: ${opts.bridge.port}.`,
      ]
    : ['(Smalltalk at: #McpBridgeServer ifAbsent: [ nil ]) ifNotNil: [ :c | c stop ].'];

  const restoreAuthor = ['Utilities setAuthorName: author initials: initials.'];

  const writeReadyFile = [
    `${smalltalkString(opts.readyFile)} asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'armed='; print: (Smalltalk at: #SignalTrap) isArmed ]`,
  ];

  const errorHandler = [
    "] on: Error do: [ :e | Transcript show: 'cuisctl start failed: ', e messageText; newLine. Smalltalk quitPrimitive: 1 ]",
  ];

  return [
    ...header,
    ...bodyStart,
    ...bridgeLines,
    ...restoreAuthor,
    ...writeReadyFile,
    ...errorHandler,
  ].join('\n');
}
