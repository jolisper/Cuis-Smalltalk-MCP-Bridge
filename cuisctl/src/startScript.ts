/**
 * Smalltalk script builders for `cuisctl start` (buildStartScript) and
 * `cuisctl run` (buildRunScript).
 *
 * Constraints on the emitted script:
 * - Temps are declared on line 1 (`| author initials |`); headless-pitfalls
 *   requires this, otherwise the headless VM misparses the file.
 * - Line 2 carries marker comments (`"cuisctl-ready: ..."`, `"cuisctl-bridge-port: ..."`)
 *   which the fake VM used by the tests (and run records) read back.
 * - `CodePackageFile installPackage:` is allowed in this file only (staticChecks).
 *
 * buildRunScript structure (line groups, in order):
 * 1. header     - temps line, marker comments (ready, run-code, run-outcome, run-nonce),
 *                 `Transcript logToStdout: true.`
 * 2. boot       - opens the protected block `[`, saves/sets the author, installs SignalTrap
 *                 if absent, writes the ready file (armed=...). The author is NOT restored
 *                 here: the image's author is empty, so a change recorded by the user's code
 *                 would open the modal author-initials prompt and hang the headless run.
 *                 It stays 'cuisctl' through the evaluation and is restored right after END.
 * 3. evaluation - prints `<nonce> BEGIN`, reads the code file and evaluates it with
 *                 `Compiler new evaluate:in:to:notifying:ifFail:` (syntax errors and
 *                 Error/UnhandledError/Halt/Warning/SyntaxErrorNotification mark the run failed),
 *                 truncates the result to 4096 chars, defines `escape`, computes elapsed
 *                 time, prints `<nonce> END`, then restores the author.
 * 4. outcome    - writes the outcome file, then closes the block with an `on: Error do:`
 *                 handler that reports and quits with status 1.
 *
 * Outcome file format (one `key=value` per line, in this order, LF separated):
 *   status=passed|failed
 *   elapsedMs=<integer>
 *   result=<printString of the value, escaped, at most 4096 chars>
 *   resultTruncated=true|false
 *   error=<message text, escaped; empty when passed>
 *   done
 * Values for result and error are escaped: `\` -> `\\`, LF -> `\n`, CR -> `\r`, so each
 * value stays on one line. `done` marks a complete file. The file is written to
 * `<outcome>.tmp`, any existing outcome file is deleted, then the temp is renamed into
 * place, so readers never observe a partial outcome.
 *
 * Verified Cuis facts:
 * - The inner evaluation handler must list Error explicitly: an Error that has a handler
 *   (the outer `on: Error do:` quit handler) is never 'unhandled', so UnhandledError alone
 *   would never fire and the outer handler would swallow it (verified on a real Cuis).
 * - `Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [...]` is the
 *   evaluation entry point (answers the value, runs the ifFail block on syntax errors).
 * - `FileEntry>>rename:` errors when the target already exists (hence the explicit delete),
 *   and takes a bare file name (basename), not a path.
 * - `Exception>>messageText` may be nil, so handlers fall back to `description`.
 */
import { basename } from 'node:path';
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

export function buildRunScript(opts: {
  readyFile: string;
  signalTrapPackage: string;
  codeFile: string;
  outcomeFile: string;
  nonce: string;
}): string {
  const tmpOutcomeFile = `${opts.outcomeFile}.tmp`;
  const outcomeEntry = `${smalltalkString(opts.outcomeFile)} asFullFileEntry`;
  const tmpOutcomeEntry = `${smalltalkString(tmpOutcomeFile)} asFullFileEntry`;

  const header = [
    '| author initials startMs elapsed status result error truncated escape |',
    `"cuisctl-ready: ${opts.readyFile}" "cuisctl-run-code: ${opts.codeFile}" "cuisctl-run-outcome: ${opts.outcomeFile}" "cuisctl-run-nonce: ${opts.nonce}"`,
    ...logToStdout,
  ];

  const boot = [
    ...bodyStartLines(opts.signalTrapPackage),
    ...writeReadyFileLines(opts.readyFile).map((l) => `${l}.`),
  ];

  const evaluation = [
    `Transcript newLine; show: '${opts.nonce} BEGIN'; newLine.`,
    'startMs := Time millisecondClockValue.',
    "status := 'passed'. result := ''. error := ''. truncated := false.",
    `${smalltalkString(opts.codeFile)} asFullFileEntry fileContents ifNotNil: [ :src | [ result := (Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [ status := 'failed'. error := 'syntax error'. nil ]) printString ] on: Error, UnhandledError, Halt, Warning, SyntaxErrorNotification do: [ :e | error := (e messageText ifNil: [ e description ]) asString. status := 'failed'. e return: nil ] ].`,
    'truncated := result size > 4096. truncated ifTrue: [ result := result copyFrom: 1 to: 4096 ].',
    "escape := [ :t | ((t copyReplaceAll: '\\' with: '\\\\') copyReplaceAll: (String with: Character lf) with: '\\n') copyReplaceAll: (String with: Character cr) with: '\\r' ].",
    'elapsed := Time millisecondClockValue - startMs.',
    `Transcript newLine; show: '${opts.nonce} END'; newLine.`,
    ...restoreAuthor,
  ];

  const outcomeWrite = [
    `${tmpOutcomeEntry} forceWriteStreamDo: [ :s | s nextPutAll: 'status='; nextPutAll: status; newLine; nextPutAll: 'elapsedMs='; nextPutAll: elapsed printString; newLine; nextPutAll: 'result='; nextPutAll: (escape value: result); newLine; nextPutAll: 'resultTruncated='; nextPutAll: truncated printString; newLine; nextPutAll: 'error='; nextPutAll: (escape value: error); newLine; nextPutAll: 'done'; newLine ].`,
    `(${outcomeEntry}) exists ifTrue: [ (${outcomeEntry}) delete ].`,
    `(${tmpOutcomeEntry}) rename: ${smalltalkString(basename(opts.outcomeFile))}`,
  ];

  const errorHandler = [
    "] on: Error do: [ :e | Transcript show: 'cuisctl run failed: ', e description; newLine. Smalltalk quitPrimitive: 1 ]",
  ];

  return [...header, ...boot, ...evaluation, ...outcomeWrite, ...errorHandler].join('\n');
}

const logToStdout = ['Transcript logToStdout: true.'];

const restoreAuthor = ['Utilities setAuthorName: author initials: initials.'];

function bodyStartLines(signalTrapPackage: string): string[] {
  return [
    '[',
    'author := Utilities classPool at: #AuthorName.',
    'initials := Utilities authorInitialsPerSe.',
    "Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.",
    `(Smalltalk includesKey: #SignalTrap) ifFalse: [ CodePackageFile installPackage: ${smalltalkString(signalTrapPackage)} asFullFileEntry ].`,
  ];
}

function writeReadyFileLines(readyFile: string): string[] {
  return [
    `${smalltalkString(readyFile)} asFullFileEntry forceWriteStreamDo: [ :s | s nextPutAll: 'armed='; print: (Smalltalk at: #SignalTrap) isArmed ]`,
  ];
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
    ...logToStdout,
  ];

  const bodyStart = bodyStartLines(opts.signalTrapPackage);

  const bridgeLines = opts.bridge
    ? [
        `(Smalltalk includesKey: #McpBridgeServer) ifFalse: [ CodePackageFile installPackage: ${smalltalkString(opts.bridge.packageFile)} asFullFileEntry ].`,
        `(Smalltalk at: #McpBridgeServer) stop; startOn: ${opts.bridge.port}.`,
      ]
    : ['(Smalltalk at: #McpBridgeServer ifAbsent: [ nil ]) ifNotNil: [ :c | c stop ].'];

  const writeReadyFile = writeReadyFileLines(opts.readyFile);

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
