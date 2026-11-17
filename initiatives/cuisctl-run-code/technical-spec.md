# cuisctl-run-code — technical spec

Behavior is defined in [functional-spec.md](functional-spec.md); invariants are cited by number.

## Context

`cuisctl` (`cuisctl/src`) is a TypeScript CLI. `cli.ts` wires argv/env to `runCli` (`runCli.ts`), which parses with `util.parseArgs` (strict, boolean-only options, `runCli.ts:79-130`), gates the platform, checks each command's `accepts` flags, and dispatches via a command table (`runCli.ts:60-100`). Every command returns a `Result` (`output.ts:15`) that is rendered to text or JSON; the exit code is a pure function of it (`output.ts:23`, 0 / 1 / 2 for `usage`).

What `run` builds on, all in `commands/start.ts`:
- `launchVm` (`:149`) writes `start.st` and spawns the VM through `spawnVm` (`launcher.ts:75`), stdout/stderr appended to `vm.log`, detached, cwd `files/`.
- `waitForReadiness` (`:174`) polls the `ready` file written by the script; races VM exit and the start timeout. `failStart` (`:209`) kills the VM and raises `start_failed` with the `vm.log` tail. `killVm` (`:203`).
- `startStoppedInstance` (`:228`) writes the run record (`runRecord.ts`) so `status`/`stop` see the VM. `instanceState` (`state.ts:38`) detects tracked and untracked running VMs.
- `withInstanceLock` (`commands/instanceLock.ts`) gives `busy`; `stopWithSave` / `killAndForget` (`stop.ts:94,106`) kill or SIGTERM-save a VM. `SignalTrap.pck.st` makes SIGTERM save the image (the save runs in its own Smalltalk process; saving from the script process itself is unsafe because the resumed image would continue the old script).
- `startScript.ts` is the only file allowed to contain `installPackage` (`staticChecks.test.ts`); `processControl.ts`/`launcher.ts` are the only ones allowed to call `process.kill`.

Prior art in this repo: `mcp-bridge/server/src/runSmalltalk/{harness,outcome,input}.ts` wraps user code with `Compiler new evaluate:` under `on: UnhandledError, Halt, Warning, SyntaxErrorNotification`, uses nonce-tagged lines, and applies the same 16 KB head / 48 KB tail / 4 KB result caps and a 60 s default / 300 s max timeout. Adopted as a pattern, not imported (static checks forbid importing `mcp-bridge`). It runs on a pristine base image and escapes payloads onto one line; `run` differs by using the instance image and a side file for the structured outcome. No `research/` directory exists for this initiative.

## Proposed changes

### Result shape (invariants 13, 36–38)

`Result`'s failure variant gains optional `command` and `data`: `{ ok:false, command?:'run', error:{kind,message,hint?}, data?: RunView }`. A failed or timed-out run carries `data` next to `error`; a passed run is `{ ok:true, command:'run', data: RunView }`. Consumers read `.data` in both cases. `exitCode` is unchanged. `renderText` renders `RunView` as one document (status line, elapsed, saved, output block, result, error) whenever `data` is present, then no extra `error:` line. Existing results never set the new fields, so their JSON is unchanged (39).

```ts
interface RunView {
  name: string; status: 'passed'|'failed'|'timed_out';
  elapsedMs: number;                       // integer; code only
  output: string; outputBytes: number; outputTruncated: boolean;
  result?: string; resultTruncated: boolean;   // only when the code completed
  error?: string;                          // failed only
  saved: boolean; detached: boolean;
}
```

New `ErrorKind`s: `run_failed`, `run_timed_out`, plus `interrupted` (see Risks: not in the functional spec; needed because a document must still be emitted on Ctrl-C, 34/36). README documents all three.

### CLI surface (1–7, 39–41)

- `runCli.ts`: add string options `file`, `timeout` and booleans `gui`, `detach`, `stdin` (`save` is shared with `stop`) to `OPTIONS`/`Flags`; the "flag accepted?" check treats any set flag (`!== undefined && !== false`) not in the command's `accepts` as `unknown option` (so `start --stdin` / `create --save` stay usage errors, 39). `run` entry: `accepts` all of the above plus `headless`; takes name plus one optional positional (the code), so `execute`'s "too many arguments" check becomes per-command (`maxArgs`). `--headless`+`--gui` is a usage error. `-`-leading inline code is rejected by `parseArgs` as an unknown option (5); `--` still lets it through, which is harmless.
- Stdin seam: `CliContext.readStdin?: () => Promise<{ text: string; isTTY: boolean }>`, supplied only by `cli.ts` (`process.stdin`); `run` is the only caller (40). `runCli.ts`/`cli.ts` header comments ("never reads stdin") are revised.
- Interrupt seam: `CliContext.signal?: AbortSignal`, aborted by `cli.ts` on SIGINT/SIGTERM. `process.on` stays in `cli.ts`; no new `process.kill` use.
- `commands/runInput.ts` (pure, injected `readStdin`/`readFile`): exactly one source (3), non-blank code (3), `--file` readable relative to cwd (41), stdin TTY/empty → `usage` without waiting (4), `--timeout` `/^[1-9]\d*$/` seconds, default **60**, max **300** (matches the existing `run_smalltalk` tool; resolves the open question in 7), anything else `usage`, never clamped. Runs before any home preparation or VM (32); stdin is read only after the shape checks so conflicting sources never block on it.

### `commands/run.ts` flow

`runRun(opts): Promise<Result>` never rejects. Order: `validateName` → `resolveRunInput` → `readInstance` + `requireCurrentCuisVersion` → `withInstanceLock` (`busy`, 33) → `instanceState` ≠ stopped ⇒ `instance_running` with hint `cuisctl stop <name>`, nothing signalled (30) → `ensureHome` (prepares a missing home; no `home_not_ready`, 29) → run, inside `try/finally` so every exit path cleans up:

1. **Backup**: copy `image` and `changes` into `instances/<name>/run-backup/` (clone copy; instant on APFS).
2. **Launch**: write `run-code.st` (the user code, verbatim, so no quoting issues) and `run.st` (`buildRunScript`), delete stale `ready`, `run-outcome`, remove stale run record, note `vm.log` size as the output offset, spawn via the shared boot helper in the chosen mode (headless default, 2).
3. **Ready** (reuse `waitForReadiness`, start timeout): failure ⇒ kill, restore, `start_failed` with log tail (31). On ready write the run record (`saveOnStop` from the `armed=` content) and start the code clock.
4. **Await the code**: poll every 50 ms for a complete `run-outcome` file, VM exit (⇒ `failed`, "VM ended before the code completed", 11/28/35), the `--timeout` deadline (⇒ `timed_out`, 12/18) or `signal.aborted` (34). The outcome file is checked before the deadline.
5. **Finish by status**: `timed_out` ⇒ kill (26). `--save` + `passed` ⇒ `stopWithSave` (SIGTERM → SignalTrap saves; reused, exported from `stop.ts`); its `not_saved` is caught and turned into `data` + `error{not_saved}` (24); success ⇒ `saved:true` (22). `--detach` + `passed|failed` ⇒ leave the VM and run record, release the lock on return, delete the backup (25, 27, 33). Everything else ⇒ kill (`killAndForget`).
6. **Restore** iff the run is not saved or detached (default, `--save` failed/timed_out, `--detach` timed_out): VM confirmed dead (`waitForExit`), then copy each backup to a temp file beside the target and `rename` over it (19, 21, 23). Remove run record, `run-code.st`, `run.st`, `run-outcome`, backup.
7. **Report**: build `RunView`; `failed` ⇒ `run_failed` + `error` text, `timed_out` ⇒ `run_timed_out`; progress only via `onProgress` (stderr, 36).

Elapsed (15): Smalltalk measures it for `passed`/`failed` and writes `elapsedMs`; for `timed_out` and VM-death the CLI reports its own millisecond clock from code start.

### Smalltalk side: `buildRunScript` (in `startScript.ts`)

Shares `smalltalkString`, the line-1 temp declaration rule and the marker-comment header with `buildStartScript` (comments `"cuisctl-run-code: <path>" "cuisctl-run-outcome: <path>" "cuisctl-run-nonce: <n>"`, read by the fake VM). Sequence: `Transcript logToStdout: true`; set author `cuisctl`; install SignalTrap if absent; restore author; write the `ready` file (`armed=…`); `Transcript newLine; show: '<nonce> BEGIN'; newLine`; evaluate the code file with `Compiler new evaluate:` under `on: UnhandledError, Halt, Warning, SyntaxErrorNotification do:` (no debugger can open, 17), timing it with the millisecond clock; `'<nonce> END'` line; write `run-outcome` (`status=`, `elapsedMs=`, escaped `result=` capped at 4096 chars with `resultTruncated=`, escaped `error=`, final `done` line, written complete via temp+rename). The script ends without quitting; the CLI decides the VM's fate. Structured data goes in the side file, not in `vm.log`, so user output cannot forge a result.

### Output capture (14, 16)

`runOutcome.ts` (`captureOutput`): never loads `vm.log` whole. Find the `BEGIN` marker scanning forward from the saved offset; find `END` scanning backward from EOF (absent when killed/crashed ⇒ EOF). Read at most the first 16 KB and last 48 KB of the range, drop one trailing `\n` (the one the `END` line adds), report `outputBytes` of the full range and `outputTruncated`, decode with replacement chars (a cut may split a UTF-8 sequence). `result` is capped again at 4 KB as a safeguard. Status never reads this text (16).

### Shared boot code and other touched files

- `vmBoot.ts` (new): move `LaunchedVm`, the spawn half of `launchVm` (script path and mode as parameters), `waitForReadiness` (bridge checks stay behind an optional hook supplied by `start.ts`), `killVm`, `failStart`, `logTail`, `sleep` out of `start.ts`; `start.ts` imports them. Tradeoff: refactoring `start.ts` risks regressions (39), but duplicating ~80 lines of boot logic would let the two diverge; the existing `start` tests are the safety net and run first.
- `imageBackup.ts` (new): `backupImage` / `restoreImage` (atomic rename per file).
- `paths.ts`: `runScript`, `runCode`, `runOutcome`, `runBackup`. `errors.ts`, `output.ts` as above. `stop.ts`: export `stopWithSave`, `killAndForget`, `StopTarget` (no behavior change).
- Tests' fake VM (`testSupport/fakeRunningVm.mjs`): read the new marker comments and act per `fake-vm.json` (`run: passed|failed|hang|quit|flood|saveImage|neverReady`), writing the outcome file and `BEGIN/END` lines, and mutating image/changes to prove restore.
- Docs: `cuisctl/README.md` (the line at `:253` becomes "only `run --stdin` reads stdin"; add `run`, options, outcome, error kinds, exit codes), `.claude/skills/cuisctl/SKILL.md`, `.claude/skills/run-cuisctl/SKILL.md`.

## Implementation sequence

1. `cuisctl/src/errors.ts` — add `run_failed`, `run_timed_out`, `interrupted`
2. `cuisctl/src/paths.ts` — run script, code, outcome and backup paths
3. `cuisctl/src/output.ts` — optional `command`/`data` on failures, `RunView`, `renderRun`
4. `cuisctl/src/vmBoot.ts` and `commands/start.ts` — extract shared boot helpers; existing start tests stay green
5. `cuisctl/src/commands/stop.ts` — export `stopWithSave`, `killAndForget`, `StopTarget`
6. `cuisctl/src/imageBackup.ts` — backup and atomic restore
7. `cuisctl/src/commands/runInput.ts` — source/timeout validation
8. `cuisctl/src/startScript.ts` — `buildRunScript`; spike against a real VM to confirm Transcript flushing, syntax-error capture, millisecond clock, no debugger in GUI
9. `cuisctl/src/runOutcome.ts` — outcome-file parser, streaming output capture, caps
10. `cuisctl/src/testSupport/fakeRunningVm.mjs`, `fakeVm.ts` — run behaviors
11. `cuisctl/src/commands/run.ts` — the run flow
12. `cuisctl/src/runCli.ts`, `cuisctl/src/cli.ts` — options, command entry, stdin and signal seams
13. `cuisctl/src/realCuis.integration.test.ts` — gated real-VM run cases
14. `cuisctl/README.md`, `.claude/skills/cuisctl/SKILL.md`, `.claude/skills/run-cuisctl/SKILL.md` — docs

## Testing and validation

Unit and command tests use the existing fake-VM/temp-home harness (`makeLifecycleHome`, `snapshotTree`); one gated integration test runs a real headless VM; `/spec-verify-dynamic` drives the built CLI through `run-cuisctl`.

| Invariants | Verified by |
|---|---|
| 1–7 | `runInput.test.ts` + `runCli.test.ts`: each source, conflicts, empty/missing file, `--save`+`--detach`, `--headless`+`--gui`, `-`-leading code, every `--timeout` edge (0, -1, `abc`, `301`, `1.5`); assert home and instance dir untouched (3, 32) |
| 4, 40 | `cli.test.ts`: spawn the built CLI with TTY-less empty stdin and with a closed stdin ⇒ immediate `usage`; `readStdin` spy shows no other command reads it |
| 6, 8, 21 | integration: `3 + 4` ⇒ `7`; no-value code ⇒ `nil`; class defined by one run is absent in the next; class saved by `--save` is visible to the next run |
| 9–12, 17, 35 | `run.test.ts` with fake VM: passed/failed/timed_out/exit-mid-run/quit; `start_failed` is not a run status; integration: `1/0`, syntax error and `halt` return promptly in headless and `--gui` |
| 13, 36–38 | `output.test.ts` golden JSON/text for all three statuses; `runCli.test.ts` checks one stdout document, `--json` position, exit codes 0/1/2, no stdout noise from progress |
| 14, 15 | integration: `Transcript show:` output in order, also before an error; `(Delay forMilliseconds: 300) wait` reports `elapsedMs` ≥ 300 and < 300 + boot time; fake VM: timed_out still reports elapsed |
| 16 | `runOutcome.test.ts`: 10 MB output keeps 16 KB + 48 KB, correct `outputBytes`, bounded RSS; status from untruncated run; 5 KB result truncated |
| 18, 26, 31, 34 | `run.test.ts`: `hang` ends within timeout + grace; SIGTERM/abort mid-run kills the VM, restores, releases the lock, leaves no `run.json`; `neverReady` ⇒ `start_failed` with 20-line tail |
| 19, 20, 21, 23 | `snapshotTree` of `image/` before vs after for default runs of every status, including a fake run that overwrites image and changes; a file written to `files/` persists |
| 22, 24 | `--save` passed ⇒ `saved:true` and image changed; `--save` failed/timed_out ⇒ restored; fake `onTerm: ignore`/`unarmed` ⇒ `not_saved` with outcome in `data` |
| 25, 27, 28 | `--detach`: `status` shows pid and mode, `stop` and `stop --save` work, `start` same mode is `alreadyRunning`, other mode `instance_running`, `run` refused; code that quits leaves nothing running |
| 29, 30, 33 | `run.test.ts`: `busy` with a held lock while `status` and another instance's `start` still work; running tracked and untracked ⇒ `instance_running`, nothing signalled; missing home prepared |
| 39, 41 | existing suites unchanged and green after step 4; `runCli.test.ts` keeps `start --stdin`/`create --save` as unknown option; static checks still pass |

## Risks and mitigations

- **Image restore vs. hard kill**: SIGKILL of `cuisctl` itself (not 34) can leave a modified image and `run-backup/`. Mitigation: backup is only deleted after a successful restore; a follow-up can make the next `run`/`start` self-heal from it.
- **Transcript buffering**: output before a kill (14) depends on `logToStdout` writing unbuffered. Phase 8 spike must confirm on Cuis 7.8; if not, add an explicit flush after each write.
- **Saving image from the script process** is deliberately avoided (SignalTrap path reused); `--save` therefore needs SignalTrap armed, else `not_saved` (matches `stop --save`).
- **`interrupted` kind** is an addition to the functional spec's error list; confirm or fold into `internal_error`.
- **Disk floods**: `vm.log` can grow without bound within the timeout; memory is bounded, disk is not.
- **`start`'s default is GUI, `run`'s is headless** (open question in 2): implemented as specced; both are explicit in README.

## Follow-ups

- Self-heal a leftover `run-backup/` on the next command.
- Share the save-wait logic between `stop --save` and `run --save` instead of reusing it through exports.
