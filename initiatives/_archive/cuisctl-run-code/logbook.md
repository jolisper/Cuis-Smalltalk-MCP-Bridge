---
status: archived
archived: 2026-11-16
started: 2026-11-14
spec: initiatives/cuisctl-run-code/technical-spec.md
last-completed-phase: 14
---


# Implementation Log: cuisctl-run-code

Implementing the cuisctl 'run' command (execute Smalltalk code in a named Cuis instance, disposable by default, structured outcome) in 14 phases, starting at phase 1. Done = all phases complete, existing suites green, auto verification passes.

## Phase Plan

1. [Scaffold] errors.ts: run_failed, run_timed_out, interrupted
2. [Scaffold] paths.ts: run script/code/outcome/backup paths
3. [TDD] output.ts: command/data on failures, RunView, renderRun
4. [Scaffold] vmBoot.ts + start.ts: extract shared boot helpers
5. [Scaffold] stop.ts: export stopWithSave, killAndForget, StopTarget
6. [TDD] imageBackup.ts: backup and atomic restore
7. [TDD] runInput.ts: source and timeout validation
8. [TDD] startScript.ts: buildRunScript
9. [TDD] runOutcome.ts: outcome parser, streaming capture, caps
10. [Scaffold] fake VM run behaviors
11. [TDD] run.ts: the run flow
12. [TDD] runCli.ts, cli.ts: options, run entry, stdin/signal seams
13. [Scaffold] gated real-VM integration tests
14. [Scaffold] docs: README and skills

## Phase 1 — [Scaffold] errors.ts

Added run_failed, run_timed_out, interrupted to ErrorKind in errors.ts; tsc clean, vitest green (253 passed, 20 skipped).

## Phase 2 — [Scaffold] paths.ts

Added runScript, runCode, runOutcome, runBackup to InstancePaths; updated paths.test.ts deep-equal; tsc clean, vitest green.

### Phase 3 cycles

- cycle 3.1 [covered=1]: renderText of ok run result (passed, output empty, result '7', elapsed 12) renders 'demo: passed (12 ms)\n  saved: no\nresult: 7\n' — red: run passed render; green: RunView + renderRun; refactor: doc comment
- cycle 3.2 [covered=2]: renderText of a run result with non-empty output renders an 'output:' block with the output text before the result line — red: output block; green: emit output block when non-empty; refactor: deferred to later cycle
- cycle 3.3 [covered=3]: renderText of a failed run via an ok:false Result carrying command 'run' and data (status failed, error 'ZeroDivide') renders the run document ending with 'error: ZeroDivide' exactly once, with no separate error line — red: failed run doc w/ error line; green: Result failure gains command/data, renderText uses renderRun; refactor: deferred
- cycle 3.4 [covered=4]: renderText labels status timed_out as 'timed out' in the first line — red: timed out label; green: label mapping; refactor: deferred
- cycle 3.5 [covered=5]: renderText of a run view with outputTruncated true (outputBytes 70000) and resultTruncated true appends '[output truncated: 70000 bytes in total]' after the output block and ' [truncated]' after the result text — red: output truncation notice; green: notice after output block; refactor: deferred
- cycle 3.6 [covered=6]: renderText of a run view with resultTruncated true appends ' [truncated]' after the result text on the result line — red: result truncated marker; green: ' [truncated]' suffix; refactor: deferred
- cycle 3.7 [covered=7]: renderText of a run view with saved true renders '  saved: yes' — red: saved yes test passed immediately (characterization; ternary written ahead in 3.1); no green change
- cycle 3.8 [covered=8]: renderText of a run view with keptRunning true renders a '  kept running: yes' line after the saved line — red: kept running line; green: line when keptRunning; refactor: renderRun cleanup + doc comments

## Phase 3 — [TDD] output.ts

8 cycles: RunView, renderRun (status line, saved, kept running, output block, truncation notes, result, error), Result failure command/data. Deviations: cycle 3.7 characterization test passed immediately; refactors batched at cycle 3.1 and phase end; renderJson/exitCode for failures with data not separately tested (unchanged code).

## Phase 4 — [Scaffold] vmBoot.ts + start.ts

Extracted vmBoot.ts (spawnInstanceVm, waitForReadiness with checkReady hook, killVm, failStart, logTail, sleep, LaunchedVm, ReadinessOutcome); start.ts uses it; tsc clean, vitest green.

## Phase 5 — [Scaffold] stop.ts

Exported stopWithSave, killAndForget, StopTarget; tsc clean, vitest green.

### Phase 6 cycles

- cycle 6.1 [covered=1]: backupImage(paths) copies the image and changes files byte-for-byte into paths.runBackup under their own file names — red: backup copies image+changes; green: backupImage; refactor: deferred (InstancePaths import to fix from paths.js)
- cycle 6.2 [covered=2]: restoreImage(paths) after the live image and changes files were overwritten restores their original bytes from paths.runBackup — red: restore from backup; green: restoreImage via copyFile; refactor: deferred
- cycle 6.3 [covered=3]: restoreImage replaces each live file by renaming a temp copy over it (a hard link made to the modified live file before restore still holds the modified bytes) and leaves no temp file in the image directory — red: atomic restore via hard-link probe; green: temp copy + rename with cleanup; refactor: none needed

## Phase 6 — [TDD] imageBackup.ts

3 cycles: backupImage, restoreImage, atomic restore (temp + rename, cleanup on failure). Files: imageBackup.ts, imageBackup.test.ts. Stale-backup overwrite and missing-live-file restore rely on copyFile/rename semantics, not separately tested.

### Phase 7 cycles

- cycle 7.1 [covered=1]: resolveRunInput with inline code and no other source returns {code} (source inline) for that code — red: inline code default timeout; green: stub returning code+60; refactor: deferred
- cycle 7.2 [covered=2]: resolveRunInput with no code, file or stdin rejects with a CuisctlError of kind usage — red: no source usage; green: throw usage when code undefined; refactor: deferred
- cycle 7.3 [covered=3]: resolveRunInput with file 'prog.st' returns the text readFile gives for 'prog.st' as code — red: file source; green: readFile branch; refactor: deferred
- cycle 7.4 [covered=4]: resolveRunInput with stdin true returns the text readStdin gives (isTTY false) as code — red: stdin source; green: stdin branch; refactor: deferred
- cycle 7.5 [covered=5]: resolveRunInput with stdin true rejects with usage (mentioning stdin) when readStdin reports isTTY true, whatever its text — red: stdin TTY usage; green: isTTY throws; refactor: deferred
- cycle 7.6 [covered=6]: resolveRunInput rejects with usage when the code from inline, file or stdin is empty or only whitespace — red: blank code usage (3 sources); green: trim check after resolution; refactor: deferred
- cycle 7.7 [covered=7]: resolveRunInput rejects with usage, without calling readStdin or readFile, when more than one of code, file and stdin is given — red: source conflicts; green: source count check; refactor: deferred
- cycle 7.8 [covered=8]: resolveRunInput with file whose readFile rejects throws usage naming the file path — red: unreadable file usage; green: try/catch around readFile; refactor: deferred
- cycle 7.9 [covered=9]: resolveRunInput maps --timeout '5' to timeoutSeconds 5 and '300' to 300 — red: timeout parsing; green: Number(opts.timeout); refactor: deferred
- cycle 7.10 [covered=10]: resolveRunInput rejects with usage naming --timeout for timeout values '0', '-1', 'abc', '1.5', '301', '' and ' 5' — red: invalid timeouts; green: regex + max 300; refactor: deferred
- cycle 7.11 [covered=11]: resolveRunInput rejects with usage for keep together with keepRunning, and for headless together with gui, before reading any source — red: keep/keepRunning and headless/gui conflicts; green: conflict throws; refactor: phase-end cleanup into helpers

## Phase 7 — [TDD] runInput.ts

11 cycles: inline/file/stdin sources, no-source, conflicts, blank code, unreadable file, stdin TTY, timeout parse/validate (default 60, max 300), keep/keepRunning and headless/gui conflicts. Refactor batched at phase end. Note: timeout validated after source read.

### Phase 8 cycles

- cycle 8.1 [covered=1]: buildRunScript puts a temp declaration on line 1 and the cuisctl-ready, cuisctl-run-code, cuisctl-run-outcome and cuisctl-run-nonce marker comments on line 2 — red: line1 temps/line2 markers; green: buildRunScript skeleton; refactor: deferred
- cycle 8.2 [covered=2]: buildRunScript logs the Transcript to stdout, sets author cuisctl, installs SignalTrap only when absent (quotes escaped in the path), restores the author, and writes the ready file with armed= after the install — red: boot sequence order; green: shared helpers extracted, run boot emitted; refactor: done as part of green
- cycle 8.3 [covered=3]: buildRunScript prints the nonce BEGIN line after the ready file is written, then the code evaluated from the code file via Compiler new evaluate under on: UnhandledError, Halt, Warning, SyntaxErrorNotification, then the nonce END line — red: BEGIN/evaluate/END order; green: emitted with one-keyword Compiler new evaluate: (invalid on real Cuis, fixed in 8.4); refactor: deferred
- cycle 8.4 [covered=4]: buildRunScript evaluates the code with the Cuis-valid form 'Compiler new evaluate: src in: nil to: nil notifying: nil ifFail: [' (verified: Compiler new does not understand single-keyword evaluate:) and reads the file with textContents-free fileContents — red: valid evaluate:in:to:notifying:ifFail: form; green: switched; refactor: deferred
- cycle 8.5 [covered=5]: buildRunScript after the END line writes the outcome file to a temp name beside the escaped outcome path with status=, elapsedMs=, result=, resultTruncated=, error= lines and a final done line, then renames the temp over the outcome path — red: outcome tmp+rename written after END; green: placeholder outcome lines + rename:; refactor: deferred. Verified on real Cuis: FileEntry>>rename: takes bare name and ERRORS if target exists
- cycle 8.6 [covered=6]: buildRunScript deletes an existing outcome file (exists ifTrue: delete) after writing the temp file and before the rename:, because FileEntry>>rename: signals an error when the target exists — red: delete existing outcome before rename; green: exists ifTrue: delete; refactor: deferred
- cycle 8.7 [covered=7]: buildRunScript reads Time millisecondClockValue before and after the Compiler evaluation and writes the difference as elapsedMs — red: elapsed via Time millisecondClockValue; green: startMs/elapsed temps; refactor: deferred
- cycle 8.8 [covered=8]: buildRunScript records the evaluated value's printString as result, and on UnhandledError, Halt, Warning or SyntaxErrorNotification (and ifFail:) records status failed with the exception messageText as error, instead of hardcoded passed/empty placeholders — red: result printString + failed status/error vars; green: variables written to outcome; refactor: deferred
- cycle 8.9 [covered=9]: buildRunScript caps the result at 4096 characters (copyFrom: 1 to: 4096) and writes resultTruncated from a variable set true only when it was cut — red: 4096 cap + truncated flag; green: truncated var; refactor: deferred
- cycle 8.10 [covered=10]: buildRunScript escapes backslash, LF and CR in result and error values (copyReplaceAll: '\' with: '\\', Character lf -> '\n', Character cr -> '\r') before writing them; idiom verified on a real Cuis image — red: escape helper; green: escape block; refactor: line groups + header docs

## Phase 8 — [TDD] startScript.ts buildRunScript

10 cycles. Deviations: real-VM spike not run in-session (only API facts verified read-only via run_smalltalk: Compiler new evaluate: single-keyword is INVALID -> evaluate:in:to:notifying:ifFail:; FileEntry>>rename: errors if target exists and takes bare name -> delete first; escape idiom OK). Script behavior (Transcript flush, GUI no-debugger, exact FileEntry calls) still unverified on a real run: covered by phase 13/verify-dynamic. Tests are string-level.

### Phase 9 cycles

- cycle 9.1 [covered=1]: parseOutcomeFile of a complete outcome text (status=passed, elapsedMs=12, result=7, resultTruncated=false, error=, done) returns {status:'passed', elapsedMs:12, result:'7', resultTruncated:false, error:''} — red: parse complete outcome; green: key=value parser; refactor: deferred
- cycle 9.2 [covered=2]: parseOutcomeFile returns undefined when the text lacks the final done line (partial write) — red: partial write undefined; green: done-line check; refactor: deferred
- cycle 9.3 [covered=3]: parseOutcomeFile unescapes \\n, \\r and \\\\ in result and error values in a single left-to-right pass (so 'a\\\\nb' becomes backslash-n text, not a newline) — red: unescape single pass; green: unescapeValue; refactor: deferred
- cycle 9.4 [covered=4]: parseOutcomeFile caps a 5000-character result at 4096 characters and reports resultTruncated true even when the file said false — red: result cap 4096; green: RESULT_CAP; refactor: deferred
- cycle 9.5 [covered=5]: captureOutput(logFile, 0, 'n1') on a log 'boot noise\n\nn1 BEGIN\nhello\nworld\n\nn1 END\nafter\n' returns output 'hello\nworld\n'... precisely the text between the BEGIN line and the END line minus one trailing newline, outputBytes equal to its byte length and outputTruncated false — red: basic capture; green: whole-file read + delimiters; refactor: deferred
- cycle 9.6 [covered=6]: captureOutput ignores a BEGIN marker that lies before the given offset and uses the one after it — red: offset skips old BEGIN passed immediately (characterization); no green
- cycle 9.7 [covered=7]: captureOutput with a BEGIN marker but no END marker (VM killed mid-run) returns everything after the BEGIN line up to the end of the file — red: no END to EOF; green: subarray(start) when no END; refactor: deferred
- cycle 9.8 [covered=8]: captureOutput with no BEGIN marker after the offset (code never started) returns empty output, 0 bytes, not truncated — red: no BEGIN empty; green: early return; refactor: deferred
- cycle 9.9 [covered=9]: captureOutput of a 100000-byte output keeps the first 16384 and last 49152 bytes only, reports outputBytes 100000 and outputTruncated true, while a 65536-byte output is returned whole and not truncated — red: 16K+48K caps; green: head/tail slice; refactor: deferred
- cycle 9.10 [covered=10]: captureOutput never loads the whole log: it does not call readFile on the log file (reads bounded windows via a file handle), and still returns the correct 16 KB head and 48 KB tail for a 5 MB output with END marker near the end — red: readFile not used; green: file-handle bounded windows (findForward/findBackward); refactor: deferred
- cycle 9.11 [covered=11]: captureOutput of a truncated output whose 16 KB head cut falls inside a multi-byte UTF-8 character decodes with replacement characters and does not throw — UTF-8 split characterization passed immediately; refactor: header docs, helpers

## Phase 9 — [TDD] runOutcome.ts

11 cycles: parseOutcomeFile (typed fields, done sentinel, unescape single pass, 4096 cap), captureOutput (BEGIN/END delimiters, offset, no END to EOF, no BEGIN empty, 16K+48K caps, bounded-memory file-handle scanning, UTF-8 replacement). Characterization tests: offset skip (9.6), UTF-8 split (9.11). END is the LAST END delimiter in the file.

## Phase 10 — [Scaffold] fake VM run behaviors

fakeRunningVm.mjs run script support: run=passed|failed|hang|quit|flood|saveImage|mutate|neverReady, elapsedMs/result/error/floodBytes config; 10 new tests in fakeRunningVm.test.ts; tsc clean, vitest green (323 passed).

### Phase 11 cycles

- cycle 11.1 [covered=1]: runRun of code '3 + 4' on a stopped instance with the fake VM run=passed (result '7') returns ok:true command run with data status passed, result '7', output containing the code, elapsedMs from the outcome, saved false, keptRunning false, and leaves the instance stopped with no run.json — red: happy path; green: runRun flow (lock, files, spawn, ready, outcome poll, capture, kill, cleanup); refactor: deferred
- cycle 11.2 [covered=2]: a default run whose VM overwrote the image and changes files (fake run=saveImage) leaves both files byte-for-byte as before, and run-backup/ is removed — red: restore after saveImage; green: backupImage/restoreImage in finally; refactor: deferred
- cycle 11.3 [covered=3]: a run whose code raises (fake run=failed, error ZeroDivide) returns ok:false with error kind run_failed, message ZeroDivide, and data status failed with error ZeroDivide, empty result, and the image still restored — red: run_failed; green: failed -> ok:false run_failed + data; also added error?: undefined to Result ok variant so tests typecheck; refactor: deferred
- cycle 11.4 [covered=4]: a run whose code hangs (fake run=hang) with timeoutMs 500 returns run_timed_out with data status timed_out, output so far, elapsedMs measured by the CLI clock, VM killed, image restored, instance stopped, within timeout plus a short grace — red: timed_out (test timed out); green: deadline in awaitOutcome, run_timed_out; refactor: deferred. Leaked fake VM from red run killed manually
- cycle 11.5 [covered=5]: a run whose VM exits before the code completes (fake run=quit) with a long timeoutMs returns promptly (well before the deadline) run_failed with data status failed and error 'VM ended before the code completed', image restored — red: VM quit mid-run (test timed out); green: race vm.exited with one last outcome read; refactor: deferred
- cycle 11.6 [covered=6]: runRun on an instance already running (started with runStart on the fake VM) fails with instance_running and hint 'cuisctl stop demo', signals nothing (VM still alive, same pid, run.json intact), creates no run files or run-backup, and leaves image/changes untouched — red: instance_running guard; green: instanceState check before side effects; refactor: deferred. Note: 5 leaked fake-VM processes (start.st) from earlier test runs observed, not killed
- cycle 11.7 [covered=7]: runRun while another command holds the instance lock fails at once with busy, creating no run files and leaving the image untouched, while runStatus on the same instance still works — busy test passed immediately (characterization; lock from 11.1)
- cycle 11.8 [covered=8]: a run whose VM never becomes ready (fake run=neverReady, startTimeoutMs 1000) fails with start_failed containing the vm.log tail, kills the VM, restores the image, leaves the instance stopped, and executes no code — start_failed test passed immediately (characterization; failStart inside try + finally cleanup)
- cycle 11.9 [covered=9]: with keep:true a passed run (fake onTerm save, armed) saves the image through stop-with-save: result ok with saved true, image holds the VM's saved bytes (not the original), instance stopped, backup and run files removed — red: keep saves; green: run record written after ready, stopWithSave on keep+passed, restore only when not saved; mode still hard-coded 'headless' in run record (to fix with --gui cycle)
- cycle 11.10 [covered=10]: with keep:true a failed run and a timed_out run are not saved: image restored byte-for-byte, saved false, statuses and error kinds unchanged — keep+failed/timed_out passed immediately (characterization)
- cycle 11.11 [covered=11]: with keep:true on a passed run whose VM cannot save (fake armed false, or onTerm ignore) runRun fails with not_saved (ok:false) carrying the passed RunView in data with saved false, the instance stopped and the image restored — red: not_saved with data; green: catch not_saved, report out-param; refactor: deferred. Image is restored after not_saved (finally, saved false)
- cycle 11.12 [covered=12]: with keepRunning:true a passed run (fake run=mutate) leaves the VM running headless with its run record (status shows running, pid, mode headless, no bridge), reports keptRunning true saved false, does not restore the image, removes backup and run files, releases the lock, and runStop then stops it — red: keepRunning hand-over; green: handedOver flag skips kill/restore/record removal; refactor: deferred
- cycle 11.13 [covered=13]: with keepRunning:true a timed_out run and a run whose code quits the VM leave nothing running: the VM is killed, the image restored, status stopped, keptRunning false, no run.json — keepRunning + timed_out/quit passed immediately (characterization)
- cycle 11.14 [covered=14]: aborting the signal mid-run (hang) kills the VM, restores the image, removes run files and run.json, releases the lock, and returns promptly ok:false kind interrupted with data status failed and error describing the interruption — red: abort mid-run; green: awaitOutcome checks signal -> interrupted; refactor: deferred. Gap: boot wait not abort-aware (next cycle)
- cycle 11.15 [covered=15]: aborting the signal while the VM is still booting (fake run=neverReady, startTimeoutMs 30000) returns promptly ok:false kind interrupted (no run status data required), kills the VM, restores the image, removes run files and the record, and releases the lock; a signal already aborted before the call returns interrupted without spawning a VM — red: abort during boot/pre-aborted; green: waitForReadiness signal option + pre-spawn check; refactor: deferred
- cycle 11.16 [covered=15]: a run whose code floods 10 MB of output (fake run=flood) passes with outputTruncated true, outputBytes about 10 MB, output of exactly 65536 bytes (16 KB head + 48 KB tail), and without loading the log into memory — flood bounded: passed immediately (characterization)
- cycle 11.17 [covered=17]: runRun with headless false (--gui) starts the VM without the -headless flag and, with keepRunning, records mode gui in the run record so instanceState reports mode gui; the default and headless true runs record headless — red: gui mode; green: headless default true + record mode; refactor: runOnce split into steps, CodeWait union, cleanUp fate

## Phase 11 — [TDD] run.ts

17 cycles: happy path, backup/restore, run_failed, run_timed_out, VM exit, instance_running, busy, start_failed, --keep (stopWithSave), keep non-save, not_saved with data, --keepRunning hand-over, abort (mid-run and boot), flood, gui mode. Characterization tests: busy, start_failed, keep+failed/timed_out, keepRunning+timed_out/quit, flood. Deviations: runRun takes pre-resolved input (resolution in runCli); not_saved path also restores the image; added error?: undefined to Result ok variant; timeout validated after stdin read in runInput; self-heal of leftover run-backup/ not implemented (spec follow-up).

### Phase 12 cycles

- cycle 12.1 [covered=1]: runCli(['run','demo','3 + 4']) on macOS dispatches runRun with code '3 + 4', default timeout 60 s and headless mode through the command table and returns exit code 0 with a stdout document containing 'demo: passed' — red: run dispatch; green: run command entry, maxArgs per command, ctx.runOptions/readStdin seams, resolveRunInput wired; refactor: deferred
- cycle 12.2 [covered=2]: runCli ['run','demo','--file',<abs path>,'--json'] runs the file's code and prints one JSON document {ok:true,command:'run',data:{status:'passed',...}} whose output contains the file's code, exit 0 — red: --file --json; green: string option file, generalized flag acceptance; refactor: deferred
- cycle 12.3 [covered=3]: runCli ['run','demo','1+1','--gui','--keep-running'] leaves the instance running in gui mode (the flags reach runRun) and exits 0 with 'kept running: yes' in the document — red: --gui --keep-running reach runRun; green: gui/keep-running options (parseArgs key keep-running); refactor: deferred. Observed once: run.test.ts interrupted-mid-run test failed under full-suite load (data undefined), 3/3 green in isolation: possible timing flake
- cycle 12.4 [covered=4]: runCli ['run','demo','x','--timeout','1'] against a hanging VM returns exit 1 with run_timed_out within about 10 s (timeout seconds reach runRun), and prints the timed out document — red: --timeout 1 hang; green: timeout string option -> resolveRunInput; refactor: deferred
- cycle 12.5 [covered=5]: runCli ['run','demo','--stdin','--keep'] reads the code through ctx.readStdin (text '3 + 4', isTTY false), keeps (saved yes with armed save VM) and exits 0; runCli never calls ctx.readStdin for other commands or for run without --stdin — red: --stdin once, never for others; green: stdin flag; refactor: deferred
- cycle 12.6 [covered=6]: runCli ['run','demo','3 + 4','--keep','--headless'] on a save-armed VM exits 0 with 'saved: yes' (keep and explicit headless accepted and honoured) — red: --keep --headless; green: keep flag, headless accepted on run, conflicts passed to resolveRunInput; refactor: deferred. Also fixed a real test race in run.test.ts abort test (wait for run.json before aborting; reproduced twice under suite load)
- cycle 12.7 [covered=7]: flags that run owns are unknown options elsewhere, named with their CLI spelling: start --stdin, create --keep, stop --keep-running, status --file x, reset --timeout 5, destroy --gui each exit 2 with 'unknown option: --<cli spelling>' and touch nothing — red: run-only flags rejected elsewhere (5 of 7 cases passed immediately); green: kebab-case flag names in the error
- cycle 12.8 [covered=8]: runCli run input problems exit 2 as usage errors before the Cuis home is prepared or any VM starts, leaving a fresh home untouched: no source, two sources, blank code, missing --file, --timeout 0/abc/301/1.5, --keep with --keep-running, --headless with --gui, and --stdin on a terminal — run input usage errors before home prep: 12 cases passed immediately (characterization; validation already ordered first)
- cycle 12.9 [covered=9]: inline code beginning with '-' is rejected by the parser as unknown option (exit 2), while after '--' it runs as code — dash-leading code: characterization passed immediately
- cycle 12.10 [covered=10]: runCli ['run','demo','1/0','--json'] against a failing VM exits 1 with one JSON document {ok:false,command:'run',error:{kind:'run_failed',...},data:{status:'failed',error,...}} and the text form prints the run document ending with 'error: ZeroDivide' once; with progress messages only on stderr (ctx.onProgress), never in stdout — failure documents JSON/text passed immediately (characterization); note: run emits no progress messages (not required by spec)
- cycle 12.11 [covered=11]: runCli passes ctx.signal to runRun: aborting it mid-run yields exit 1 and a document for the interrupted run (error kind interrupted in --json), VM killed and instance stopped — red: ctx.signal aborts run; green: signal forwarded to runRun; refactor: deferred
- cycle 12.12 [covered=12]: the built entry point (dist/cli.js) wires process.stdin into ctx.readStdin: 'run demo --stdin' with a closed (/dev/null) stdin and with an empty piped stdin exits 2 at once with a usage error and never waits; a piped blank text ('  \n') exits 2 'empty'; and 'status' with a never-closing stdin pipe does not read or wait for stdin — red: built CLI stdin cases (c blank text failed); green: cli.ts readStdin (TTY never read, error -> empty); refactor: header comments updated
- cycle 12.13 [covered=13]: the built entry point turns SIGINT (and SIGTERM) during 'run' into ctx.signal: the process kills the VM, restores the image, removes run.json, releases the lock, prints the interrupted document and exits 1 (not by dying on the signal) — red: SIGINT/SIGTERM via built CLI; green: AbortController in cli.ts; refactor: handleRun, FLAG_OPTION mapping, header docs

## Phase 12 — [TDD] runCli.ts + cli.ts

13 cycles: run dispatch, --file/--timeout/--gui/--keep/--keep-running/--stdin/--headless, per-command maxArgs, kebab-case unknown-option names, readStdin seam (cli.ts reads process.stdin only for run --stdin, never from a TTY), signal seam (SIGINT/SIGTERM -> AbortController), ctx.runOptions test seam. Characterization tests: usage errors before home prep, dash-leading code, failure documents. Note: run emits no progress messages (not required).

## Phase 13 — [Scaffold] gated real-VM integration tests

Added describe('run (real VM)') to realCuis.integration.test.ts (12 cases incl. one extra Error signal case). Real run: 9 passed, 3 failed => 3 production bugs found (fixed in phase 13b cycles): (1) outer 'on: Error' handler in buildRunScript swallows errors (ZeroDivide etc.) before the inner handler and quits the VM / hangs with nil messageText; (2) real vm.log lines carry '<ISO ts> process:N id ' prefix so captureOutput never matched BEGIN/END and output was empty; (3) nil messageText for undeclared-variable notifications gives error 'nil'. Verified real-VM facts: Transcript logToStdout not buffered, millisecond clock OK, syntax errors/Halt captured promptly, keep saves via SignalTrap headless, escape round-trip OK.

### Phase 14 cycles

- cycle 14.1 [covered=1]: PHASE 13b fix 1/4: buildRunScript evaluation handler also catches Error (on: Error, UnhandledError, Halt, Warning, SyntaxErrorNotification) so ZeroDivide and other Errors become failed outcomes instead of reaching the outer quit handler — PHASE 13b fix 1/4: red: inner handler lists Error (+2 older pins updated); green: ExceptionSet with Error
- cycle 14.2 [covered=2]: PHASE 13b fix 2/4: buildRunScript never concatenates a possibly-nil messageText: the error variable is set from (e messageText ifNil: [ e description ]) asString in the evaluation handler, and the outer failure handler prints e description instead of e messageText — PHASE 13b fix 2/4: red: nil-safe messageText; green: ifNil: description + outer handler description
- cycle 14.3 [covered=3]: PHASE 13b fix 3/4: captureOutput on a real-format log where every line has the prefix '<ISO ts> process:N id ' (BEGIN/END lines included) finds the markers, returns the output with the prefixes stripped from every line, and reports outputBytes as the raw byte length of the run's log range; unprefixed logs keep working — PHASE 13b fix 3/4: red: prefixed real-format log; green: marker search with optional Transcript prefix (lineStartOf), stripPrefixes, outputBytes raw
- cycle 14.4 [covered=4]: PHASE 13b fix 4/4 (verification): the real-VM run cases all pass on a real Cuis after fixes 1-3, including 1/0 ordering output (a then b), the 10 MB flood truncation and Error signal: 'boom' — PHASE 13b verification: real-VM run suite 13/13 pass on a real Cuis (added 'nil foo' case)

## Phase 14 — [Scaffold] docs

README (run section, stdin statement, error kinds), cuisctl SKILL (run), run-cuisctl SKILL (run recipes). Doc recipes untested live; discrepancies noted: keep-running also hands over failed runs; interrupted carries data only once code started.

Implemented cuisctl run: runInput validation, imageBackup, vmBoot extraction, buildRunScript + outcome file, runOutcome (parser + bounded-memory capture), fake-VM run behaviors, runRun flow (restore/keep/keep-running/timeouts/abort), CLI wiring (options, stdin and signal seams), docs. Deviations: runRun takes pre-resolved input (resolution in runCli); added Error to the evaluation handler and nil-safe messageText, and tolerance/stripping of the Transcript line prefix in captureOutput after a real-Cuis run exposed three bugs (phase 13b, logged as cycles 14.1-14.4); not_saved also restores the image; keep-running also hands over failed runs; outputBytes is raw log bytes; Result ok variant gained error?: undefined. Many characterization tests passed first time. Known gaps: leftover run-backup/ self-heal not implemented (spec follow-up); run emits no progress messages; stray fake-VM processes from older test runs exist outside this work.

## Implementation files

- cuisctl/src/errors.ts
- cuisctl/src/paths.ts
- cuisctl/src/paths.test.ts
- cuisctl/src/output.ts
- cuisctl/src/output.test.ts
- cuisctl/src/vmBoot.ts
- cuisctl/src/commands/start.ts
- cuisctl/src/commands/stop.ts
- cuisctl/src/imageBackup.ts
- cuisctl/src/imageBackup.test.ts
- cuisctl/src/commands/runInput.ts
- cuisctl/src/commands/runInput.test.ts
- cuisctl/src/startScript.ts
- cuisctl/src/startScript.test.ts
- cuisctl/src/runOutcome.ts
- cuisctl/src/runOutcome.test.ts
- cuisctl/src/testSupport/fakeRunningVm.mjs
- cuisctl/src/testSupport/fakeRunningVm.test.ts
- cuisctl/src/commands/run.ts
- cuisctl/src/commands/run.test.ts
- cuisctl/src/runCli.ts
- cuisctl/src/runCli.test.ts
- cuisctl/src/cli.ts
- cuisctl/src/cli.test.ts
- cuisctl/src/realCuis.integration.test.ts
- cuisctl/README.md
- .claude/skills/cuisctl/SKILL.md
- .claude/skills/run-cuisctl/SKILL.md

## Auto verification

### Run 2026-11-16

Bound: up to 2 rounds
- [r1] event: INIT {"baseline": "green"}
- [r1] event: STATIC_RUN {"covered": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41], "report": "initiatives/cuisctl-run-code/verify-static-report.md", "uncovered": [20, 27, 29]}
- [r1] event: STATIC_CLASSIFY {"deferred": [{"inv": 20, "why": "needs real Smalltalk code execution writing to files/; the fake VM does not run code, so only a live run exercises it"}], "testable": [27, 29]}
- [r1/static] inv 20: The code is not sandboxed. Files it writes (for example into the instance's `files/` folder) — skipped: deferred to dynamic: needs real Smalltalk code execution writing to files/; the fake VM does not run code, so only a live run exercises it
- [r1] event: ACT_TEST {"files": ["cuisctl/src/commands/run.test.ts"], "fix_id": "t27", "inv": 27, "outcome": "already-green", "regression": false}
- [r1/static] inv 27: A kept-alive instance follows the existing `start` rules: `start <name>` with the same mode — acted: coverage-gap test (already-green) [action: test] [fix: t27] [files: cuisctl/src/commands/run.test.ts]
- [r1] event: ACT_TEST {"files": ["cuisctl/src/commands/run.test.ts", "cuisctl/src/runCli.test.ts"], "fix_id": "t29", "inv": 29, "outcome": "already-green", "regression": false}
- [r1/static] inv 29: `usage`, `invalid_name`, `not_found`, `unsupported_platform` (not macOS), `busy`, — acted: coverage-gap test (already-green) [action: test] [fix: t29] [files: cuisctl/src/commands/run.test.ts, cuisctl/src/runCli.test.ts]
- [r1] event: DYN_PREFLIGHT {"how": "chosen", "recipe": "run-cuisctl", "why": "Four recipes exist; only run-cuisctl drives the cuisctl CLI (create/status/start/stop/reset/destroy/run) that this initiative changes. It was already extended with run recipes by the docs phase. run-cuis-mcp-bridge, run-cuis-shared-setup and run-smalltalk-tool exercise the MCP bridge, shared Cuis setup and run_smalltalk tool, not cuisctl."}
- [r1] note: recipe run-cuisctl chosen: Four recipes exist; only run-cuisctl drives the cuisctl CLI (create/status/start/stop/reset/destroy/run) that this initiative changes. It was already extended with run recipes by the docs phase. run-cuis-mcp-bridge, run-cuis-shared-setup and run-smalltalk-tool exercise the MCP bridge, shared Cuis setup and run_smalltalk tool, not cuisctl.
- [r1] event: DEP_GATE {"deps": [{"class": "local", "name": "throwaway CUISCTL_HOME"}, {"class": "local", "name": "local headless Cuis VM processes"}, {"class": "development", "name": "GitHub Cuis7-8 archive download"}], "started": true}
- [r1] event: DYN_RUN {"failed": [17], "passed": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41], "reasons": ["24:no runtime surface to exercise (could not induce a save failure; read-only image dir produced `internal_error` EACCES in the image restore instead, and the next run self-healed)", "40:no runtime surface to exercise (README content; stdin half passed)"], "report": "initiatives/cuisctl-run-code/verify-dynamic-report.md", "skipped": [[24, "no runtime surface to exercise", "could not induce a save failure; read-only image dir produced `internal_error` EACCES in the image restore instead, and the next run self-healed"], [40, "no runtime surface to exercise", "README content; stdin half passed"]]}
- [r1/dynamic] inv 24: If `--keep` is given, the code passed and the image could not be saved, the command fails — skipped: no runtime surface to exercise
- [r1] note: skip detail inv 24: could not induce a save failure; read-only image dir produced `internal_error` EACCES in the image restore instead, and the next run self-healed
- [r1/dynamic] inv 40: Only `run --stdin` ever reads standard input. The README's statement that `cuisctl` never — skipped: no runtime surface to exercise
- [r1] note: skip detail inv 40: README content; stdin half passed
- [r1] event: TRIAGE {"findings": [{"class": "defect", "evidence": "Dynamic run: code defining a class (Object subclass: #X instanceVariableNames: ... category:) hung the full 60 s and ended timed_out, with and without --keep. buildRunScript restores the image author (empty) BEFORE evaluating the user code, so compiling/recording a change opens the modal author-initials prompt in headless mode; the phase-13 real-VM agent saw the same (its tests had to set the author inside the code). No debugger/prompt may block a run (17).", "files": ["cuisctl/src/startScript.ts", "cuisctl/src/startScript.test.ts"], "inv": 17}]}
- [r1] event: CORRECT {"files": ["cuisctl/src/startScript.ts", "cuisctl/src/startScript.test.ts"], "fix_id": "f17", "inv": 17, "regression": false, "route": "tdd"}
- [r1/dynamic] inv 17: An error inside the code never leaves the run hanging until the time limit, in headless or — acted: implementation defect corrected (tdd) [action: correction] [fix: f17] [files: cuisctl/src/startScript.ts, cuisctl/src/startScript.test.ts]
- [r2] event: STATIC_RUN {"covered": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41], "report": "initiatives/cuisctl-run-code/verify-static-report.md", "uncovered": [20]}
- [r2] event: STATIC_CLASSIFY {"deferred": [{"inv": 20, "why": "needs real Smalltalk code execution writing files; the fake VM never executes code, so only a live (dynamic or gated real-VM) run exercises it; the dynamic round passed it"}], "testable": []}
- [r2/static] inv 20: The code is not sandboxed. Files it writes (for example into the instance's `files/` folder) — skipped: deferred to dynamic: needs real Smalltalk code execution writing files; the fake VM never executes code, so only a live (dynamic or gated real-VM) run exercises it; the dynamic round passed it
- [r2] event: DEP_GATE {"deps": [{"class": "local", "name": "throwaway CUISCTL_HOME"}, {"class": "local", "name": "headless Cuis VM process"}, {"class": "local", "name": "pinned Cuis archive"}], "started": true}
- [r2] event: DYN_RUN {"failed": [], "passed": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41], "reasons": ["24:no runtime surface to exercise (a save failure could not be induced on a healthy instance)", "31:no runtime surface to exercise (a boot failure could not be induced without modifying the instance)"], "report": "initiatives/cuisctl-run-code/verify-dynamic-report.md", "skipped": [[24, "no runtime surface to exercise", "a save failure could not be induced on a healthy instance"], [31, "no runtime surface to exercise", "a boot failure could not be induced without modifying the instance"]]}
- [r2/dynamic] inv 24: If `--keep` is given, the code passed and the image could not be saved, the command fails — skipped: no runtime surface to exercise
- [r2] note: skip detail inv 24: a save failure could not be induced on a healthy instance
- [r2/dynamic] inv 31: If the instance does not become ready within the start time limit, the command fails with — skipped: no runtime surface to exercise
- [r2] note: skip detail inv 31: a boot failure could not be induced without modifying the instance
- [r2] event: SUMMARY {}

## Retrospective

All 14 phases were completed: 5 scaffold phases and 9 TDD phases, in about 90 red-green-refactor cycles. Auto verification ran 2 rounds. Round 2 passed 39 invariants with none failing. Invariants 24 (save failure) and 31 (boot failure) could not be induced on a healthy instance, so they stayed unverified.

Deviations from the functional spec:
- runRun takes pre-resolved input, so input resolution lives in runCli.
- A not_saved failure also restores the image.
- --keep-running also hands over failed runs.
- outputBytes counts raw log bytes.
- The Result ok variant gained `error?: undefined`.

The fake VM never runs Smalltalk, so real-Cuis runs exposed bugs it could not: the outer `on: Error` handler pre-empted the inner one, `messageText` can be nil, `vm.log` lines carry a timestamp prefix that broke marker matching, and class definitions hung on the author-initials prompt. All four were fixed with failing tests first. Lesson: gate a real-VM suite early for anything that generates code for a real runtime.

After verification, the flags --keep and --keep-running were renamed to --save and --detach, because the names were easy to confuse. Live testing also showed that on macOS 27 the stock VM's GUI window has a fixed size. `Display fullScreenMode: true` works as a workaround. This comes from the VM, not cuisctl.

Open follow-ups: a leftover run-backup/ after a hard kill is not self-healed on the next run; run emits no progress messages; and one unreproduced "save on stop: unavailable" was seen on a --gui --detach VM.
