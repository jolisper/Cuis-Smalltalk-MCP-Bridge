# cuis-image-manager (part 02: lifecycle) — technical spec

## Context

Part 02 adds `start` and `stop` to `cuisctl`: launching an instance's VM (GUI or headless,
optionally serving the MCP bridge on 6789), arming save on stop, and ending the VM with or
without a save. Behavior is in `functional-spec.md` (invariants 1–22). Part 01 is built and
archived (`initiatives/_archive/cuis-image-manager-01-core/`); this part extends its modules
and must not break its invariants 4, 5, 13, 21 and 27.

What part 01 already gives, and where part 02 plugs in:

- `cuisctl/src/runCli.ts:40-56` — `HANDLERS` table (`create`, `status`); `:58` the only option is
  `--json`; `:104` macOS gate for every command but `status`. `start`/`stop` are unknown commands
  today. Test seams are injected through `CliContext` (`:30-35`); only `CUISCTL_HOME` comes from
  the environment (part 01 logbook, phase 12 deviation).
- `cuisctl/src/runRecord.ts:10-27` — `RunRecord {pid, startTime, mode, bridge, saveOnStop,
  startedAt}` at `instances/<name>/run.json`; read-only today. Part 02 writes and removes it.
- `cuisctl/src/state.ts:37-49` — `instanceState`: live record → `running`; a process holding
  `image/Cuis7.8.changes` (`lsof -t`) → `running_untracked`; else `stopped`. Stale records are
  ignored, never deleted. `start`/`stop` reuse it as their single state source.
- `cuisctl/src/processInfo.ts` — `processStartTime`, `processCommand`, `pidsHoldingFile`; read-only
  by contract (header, `:1-7`). Signalling goes in a new module.
- `cuisctl/src/lock.ts:91-150` — `acquireLock` (non-blocking, pid + lstart, stale takeover),
  `isLockLive`, `releaseLock`. Reused for per-instance and bridge locks.
- `cuisctl/src/launcher.ts:111-113` — `vmArgv` is headless-only and always ends with
  `-ApplePersistenceIgnoreState YES`; `runScript` (`:37-53`) runs to completion. `start` needs a
  long-lived detached spawn and a GUI argv.
- `cuisctl/src/output.ts:41-53` — `renderText` renders `create`/`status`; other commands render
  `''`. `:55` state labels; `:58-77` already shows `save on stop: available|unavailable`
  (invariant 17's `status` clause needs no new rendering).
- `cuisctl/src/errors.ts:8-19` — `ErrorKind` union.
- `cuisctl/src/instance.ts:157-167` — `readInstance` (`not_found` with a create hint); the record
  carries `cuisKey` (used for invariant 20).
- `cuisctl/src/home.ts:78` — `ensureHome(opts, onProgress)`; `start` calls it first (part 01
  invariants 14 and 17).
- `cuisctl/src/staticChecks.test.ts:43-46` — forbids `installPackage` and `Feature require` in
  every source file. Part 02 must load SignalTrap and the bridge, so this check changes (below).
- `cuisctl/src/testSupport/fakeVm.ts` — fake VM that runs `#!fake-sh` scripts to completion; no
  long-running mode.
- `mcp-bridge/image/MCP-Bridge.pck.st:389-409` — `McpBridgeServer class>>startOn:` and `>>stop`.
  `mcp-bridge/PROTOCOL.md:58-93` — handshake: one JSON line each way. `mcp-bridge/server/src/
  index.ts:16` — clients connect to `127.0.0.1:6789`.

Research this plan builds on (`initiatives/cuis-image-manager/research/`):

- `signal-trap-class.md` — the one-class `SignalTrap` package (`probes/q11/SignalTrap.pck.st`):
  loads with `installPackage:`, arms on load and at every real start-up, stays disarmed (no
  error) without `UnixOSProcessPlugin`. `trap-robustness.md` Decision: handler at
  `lowIOPriority` (60); the probe file still says `userBackgroundPriority`, so the shipped copy
  changes that one line.
- `stop-semantics.md` — saves finish 0.05–0.35 s after SIGTERM; a busy image needs SIGKILL;
  a `-s` script runs after the start-up list, so a readiness file written by it means "trap
  armed". Decision: plain `stop` is SIGKILL.
- `bridge-loading.md` — load the bridge only if absent, then `McpBridgeServer stop; startOn:`
  (exactly one listener at ~0.5 s even when a saved server resumes). A taken port makes the
  bridge silently listen on all interfaces, so the port must be checked before launch; a TCP
  connect to `127.0.0.1` caught every listener kind tested. Decision: `start` without `--bridge`
  sends `McpBridgeServer stop` when the class is loaded.
- `headless-pitfalls.md` — start scripts hang on a compile with no author, any syntax error
  (including temps not on the first line) and any uncaught error. Template: temps on line 1,
  `Transcript logToStdout: true.`, author set, work wrapped in `on: Error do:` that quits with
  code 1, readiness file last; `start` treats a missing file after a timeout as failure.
- `trap-robustness.md` — a busy forked Process saved in the image resumes and starves the start
  script; the readiness file catches it (tested, `probes/q17/ready.txt`). This is invariant 3's
  "saved state keeps it busy" case.

Research conflict: none with the code. Research's start script sets the author name
unconditionally; `Utilities class>>setAuthorName:initials:` assigns class variables that are
saved with the image, which would stamp the user's later GUI edits as `cuisctl`. The plan saves
and restores the previous values (`Utilities authorInitialsPerSe`, `Utilities classPool at:
#AuthorName`; there is no `authorNamePerSe` in 7.8, checked in the live image).

## Proposed changes

### New and changed modules (`cuisctl/src/`)

- `errors.ts` — add kinds `busy`, `instance_running` (running in another mode, or untracked;
  hint `cuisctl stop <name>`), `port_in_use`, `start_failed`, `version_mismatch`, `not_saved`.
- `paths.ts` — `InstancePaths` gains `startScript` (`<dir>/start.st`) and `readyFile`
  (`<dir>/ready`). New `locksDir(home)` = `<home>/locks/`, `instanceLockFile(home, name)` =
  `locks/<name>.lock`, `bridgeLockFile(home)` = `locks/bridge.lock`. Locks live outside
  `instances/` so part 03's `destroy` never deletes a held lock and Cuis's requirement walk
  never sees them.
- `cuisctl/image/SignalTrap.pck.st` (new asset, not under `src/`) — the probe package with the
  handler at `Processor lowIOPriority`. Resolved at run time from `import.meta.url`
  (`../image/SignalTrap.pck.st` from `dist/`).
- `runRecord.ts` — add `writeRunRecord` (temp file + `rename`, so `status` never reads half a
  record) and `removeRunRecord` (missing file is a no-op).
- `processControl.ts` (new) — the only module that signals. `signalVm(pid, startTime, signal)`
  re-reads `processStartTime(pid)` and signals only when it equals `startTime`, so a reused pid is
  never touched (invariant 10). `waitForExit(pid, startTime, timeoutMs, pollMs)` resolves `true`
  when the pid is gone or has another start time.
- `portCheck.ts` (new) — `portInUse(port)`: TCP connect to `127.0.0.1` and to `::1` with a 1 s
  timeout; connected (or timed out) → in use; `ECONNREFUSED`, `EADDRNOTAVAIL`, `ENETUNREACH`,
  `EAFNOSUPPORT` → free for that address. `listenerPids(port)`: `lsof -nP -t -iTCP:<port>
  -sTCP:LISTEN` (read-only, used to name the holder). `bridgeAnswers(port, timeoutMs)`: connect
  to `127.0.0.1`, send `{"op":"handshake","params":{"protocol_version":0}}`, read one line, true
  when it parses as JSON with a boolean `ok`. Sending a version cuisctl does not track keeps it
  independent of `mcp-bridge/server/src/protocol.ts:13`: a `protocol_mismatch` reply still
  proves the bridge is serving.
- `startScript.ts` (new) — pure `buildStartScript({readyFile, signalTrapPackage, bridge?:
  {packageFile, port}})` → Smalltalk source, plus `bridgePackageFile()` resolving
  `mcp-bridge/image/MCP-Bridge.pck.st` from `import.meta.url` (`../../mcp-bridge/image/…` from
  `dist/`). Template:

  ```smalltalk
  | author initials |
  "cuisctl-ready: <readyFile>" "cuisctl-bridge-port: <port|none>"
  Transcript logToStdout: true.
  [ author := Utilities classPool at: #AuthorName.
    initials := Utilities authorInitialsPerSe.
    Utilities setAuthorName: 'cuisctl' initials: 'cuisctl'.
    (Smalltalk includesKey: #SignalTrap) ifFalse: [
      CodePackageFile installPackage: '<trap>' asFullFileEntry ].
    "with --bridge:"
    (Smalltalk includesKey: #McpBridgeServer) ifFalse: [
      CodePackageFile installPackage: '<bridge>' asFullFileEntry ].
    (Smalltalk at: #McpBridgeServer) stop; startOn: <port>.
    "without --bridge:"
    (Smalltalk at: #McpBridgeServer ifAbsent: [ nil ]) ifNotNil: [ :c | c stop ].
    Utilities setAuthorName: author initials: initials.
    '<readyFile>' asFullFileEntry forceWriteStreamDo: [ :s |
      s nextPutAll: 'armed='; print: (Smalltalk at: #SignalTrap) isArmed ] ]
    on: Error do: [ :e |
      Transcript show: 'cuisctl start failed: ', e messageText; newLine.
      Smalltalk quitPrimitive: 1 ]
  ```

  Paths are embedded as Smalltalk string literals with `'` doubled. The marker comments let the
  fake VM find the ready file and port without parsing Smalltalk. Loading only when the class is
  absent is not a forced reload (part 01 invariant 12): an existing SignalTrap or bridge is left
  as the user saved it.
- `staticChecks.test.ts` — the `installPackage` ban gets one exception, `startScript.ts`; the
  `Feature require` ban and the `mcp-bridge` import ban stay. `bridgePackageFile` builds a path,
  not an import.
- `launcher.ts` — `vmArgv(image, script, {headless = true})`: GUI drops `-headless`; the
  `-ApplePersistenceIgnoreState YES` suffix stays. New `spawnVm({vm, image, script, cwd,
  logFile, headless})` → `{pid, exited: Promise<number | null>}`: `detached: true` (own session,
  so closing the caller's terminal sends it no SIGHUP), stdio appended to `vm.log`,
  `child.unref()` so `cuisctl` can exit while the VM runs (invariant 2). `runScript` is
  unchanged.
- `commands/instanceLock.ts` (new) — `withInstanceLock(home, name, fn)`: `mkdir locksDir`,
  `acquireLock` once; held by a live process → `busy` ("another cuisctl command is changing
  <name>"), no wait (invariant 18). Released in `finally`. `status` never takes it.
- `commands/start.ts` (new) — flow below.
- `commands/stop.ts` (new) — flow below.
- `output.ts` — `renderText` cases for `start` and `stop`. `start` data: the `InstanceView` plus
  `alreadyRunning: boolean`; text "`<name>: running`" or "`<name>: already running`" followed by
  the existing detail lines. `stop` data: `{name, outcome: 'stopped' | 'already_stopped', saved:
  boolean, reason?}`; text "`<name>: stopped, saved`", "`<name>: stopped, not saved`" or
  "`<name>: already stopped`".
- `runCli.ts` — `OPTIONS` gains `headless`, `bridge`, `save` (booleans). Each handler declares
  the flags it accepts; any other flag → `usage` (e.g. `create --save`). `start` and `stop`
  handlers, both behind the macOS gate. `CliContext` gains `startOptions`/`stopOptions`
  (port, timeouts, poll interval) for tests, injected like `createOptions`.

### `start <name> [--headless] [--bridge]`

1. `readInstance` → `not_found` (inv 4). `record.cuisKey !== CUIS_KEY` → `version_mismatch`
   naming both versions (inv 20).
2. `withInstanceLock` (inv 18).
3. `instanceState`: `running` with the same mode and bridge → ok, `alreadyRunning: true`
   (inv 5). `running` otherwise, or `running_untracked` → `instance_running`. `stopped` → remove
   any stale `run.json`.
4. `ensureHome(onProgress)`.
5. With `--bridge`: take `locks/bridge.lock`, polling every 200 ms up to the start timeout; then
   `portInUse(6789)` → `port_in_use`, naming the instance whose state pid is among
   `listenerPids(6789)` when there is one (inv 6). No VM is spawned before this point. The bridge
   lock is held until the run record is written, so a racing `start --bridge` waits, then sees the
   port taken and names the winner (inv 7).
6. Remove `ready`, write `start.st`, `spawnVm` with cwd = `files/`.
7. Wait, polling every 100 ms, until the first of: `ready` exists (and, with `--bridge`,
   `bridgeAnswers(6789)`), the child exits, or the start timeout (default 60 s) passes. With
   `--bridge`, readiness also requires `lsof -a -p <pid> -iTCP:6789 -sTCP:LISTEN` to show the
   VM listening on `127.0.0.1` only (catches the bridge's all-interfaces fallback).
8. Not ready → `signalVm(pid, SIGKILL)`, `waitForExit`, error `start_failed` with the last 20
   lines of `vm.log` (inv 3). SIGKILL means no save runs, so the image is unchanged (inv 22).
9. Ready → `writeRunRecord({pid, startTime: processStartTime(pid), mode, bridge, saveOnStop:
   ready says armed=true, startedAt})`. Release locks, return the running view.

Between spawn and step 9 `status` reports `running (untracked)`; part 01 invariant 18 defines
untracked as "cuisctl did not start it, or lost its record", which this window fits.

### `stop <name> [--save]`

1. `readInstance` → `not_found`. No version check (only `start`/`reset` refuse, inv 20).
2. `withInstanceLock`.
3. `instanceState`: `stopped` → remove stale `run.json`, ok `already_stopped` (inv 14).
   `running` → pid and `startTime` from the record. `running_untracked` → pid from `lsof`;
   proceed only if `processCommand(pid)`'s executable basename is `Squeak` (a VM holding this
   instance's `.changes` file is this instance's VM); record its `startTime` now (inv 10, 15).
4. Without `--save`: `signalVm(SIGKILL)`, `waitForExit` (5 s), remove `run.json`, ok
   `{saved: false}` "stopped, not saved" (inv 11). No in-image code runs, so the image file is
   untouched (inv 22).
5. With `--save`: when the record says `saveOnStop: false`, skip straight to SIGKILL with reason
   "save on stop unavailable" (inv 17). Otherwise snapshot the image's `mtimeMs` and size, send
   SIGTERM, `waitForExit` with the save timeout (default 10 s, about 30× the slowest observed
   save). If it exited, `saved` = image mtime or size changed. If it did not exit: when the image
   has changed since SIGTERM a save is in progress, so keep waiting up to a hard cap (60 s);
   otherwise SIGKILL with reason "the image did not save within 10 s" (inv 12). Untracked VMs get
   the SIGTERM path; an unarmed one dies with rc 143 and an unchanged image, which reports "not
   saved".
6. Remove `run.json`. Saved → ok `{saved: true}` "stopped, saved". Asked to save but not saved
   → error `not_saved` ("stopped, not saved: <reason>"), exit 1.

### Tradeoffs

- **`stop --save` that did not save exits 1.** Part 01 invariant 3 says exit 0 means "did what
  was asked"; a script doing `stop --save x && cp image backup` must not proceed. The message
  still states the instance is stopped. Alternative: ok with `saved: false`, exit 0.
- **Open question on invariant 12 (cutting off a save in progress).** The plan answers it: the
  timeout extends while the image file is changing, up to 60 s, so a save that has started is
  not killed mid-write (a cut-off write would corrupt the image, breaking inv 22). Confirm with
  the user during implementation; the simpler fixed timeout is a one-line change.
- **Racing `start --bridge` waits, then refuses.** Failing at once on a held bridge lock is
  simpler but cannot name the winner (inv 6). Waiting is bounded by the start timeout.
- **Bridge package from the repo checkout.** `cuisctl` lives in this repo, so resolving
  `mcp-bridge/image/MCP-Bridge.pck.st` relative to its own files needs no copy and stays current
  with the bridge. It ties `--bridge` to running `cuisctl` from a checkout; a missing file →
  `start_failed` before spawning.
- **Handshake with version 0.** Avoids a second copy of `PROTOCOL_VERSION`; invariant 21 is
  checked separately with the real version (below).

## Implementation sequence

1. `cuisctl/src/errors.ts` — new error kinds
2. `cuisctl/src/paths.ts` — `startScript`, `readyFile`, `locksDir`, `instanceLockFile`, `bridgeLockFile`
3. `cuisctl/image/SignalTrap.pck.st` — shipped trap package, handler at `lowIOPriority`
4. `cuisctl/src/runRecord.ts` — `writeRunRecord`, `removeRunRecord`
5. `cuisctl/src/processControl.ts` — guarded `signalVm`, `waitForExit`
6. `cuisctl/src/portCheck.ts` — `portInUse`, `listenerPids`, `bridgeAnswers`
7. `cuisctl/src/startScript.ts` and `cuisctl/src/staticChecks.test.ts` — start-script builder, package paths, `installPackage` exception
8. `cuisctl/src/launcher.ts` — GUI/headless `vmArgv`, detached `spawnVm`
9. `cuisctl/src/testSupport/fakeRunningVm.mjs` and `fakeVm.ts` — long-running fake VM
10. `cuisctl/src/commands/instanceLock.ts` — `withInstanceLock`
11. `cuisctl/src/commands/start.ts` — start flow
12. `cuisctl/src/commands/stop.ts` — stop flow
13. `cuisctl/src/output.ts` — `start`/`stop` text rendering
14. `cuisctl/src/runCli.ts` — handlers, per-command flags, context seams
15. `cuisctl/src/realCuis.integration.test.ts` — real-VM lifecycle checks
16. `cuisctl/README.md` and `.claude/skills/run-cuisctl/` — document and drive `start`/`stop`

## Testing and validation

Unit and command tests run against a temp home (`testSupport/tempHome.ts`) with a fake
distribution whose VM is a long-running fake: `fakeVm.ts` gains a mode where the shell VM
`exec`s `node fakeRunningVm.mjs "$@"` (same pid). It opens the image's `.changes` file and keeps
it open (so `lsof` sees it), reads the `cuisctl-ready`/`cuisctl-bridge-port` markers, and follows
a `fake-vm.json` written by the test: `ready` (write `armed=true|false`), `neverReady`,
`exitEarly` (exit 1 after printing a line), `bridge` (listen on the marker port and answer the
handshake), `onTerm: save | ignore | slowSave` (append to the image and exit 0, ignore, or append
in steps over N seconds). Tests use a free ephemeral port, never 6789. Opt-in real-Cuis checks
(`CUISCTL_REAL_CUIS=1`) use port 17901-style ephemeral ports through `startOptions`.

- **Invariant 1** — `startScript` unit tests: headless/GUI argv from `vmArgv`; the script for
  `--bridge` holds the bridge load and `stop; startOn:`; without it, only the guarded `stop`.
  Real: `start --headless`, `start` (GUI) and `start --bridge` each reach `running` with the
  recorded mode and bridge flag; with `--bridge`, `McpBridgeServer` is loaded into a fresh image.
- **Invariant 2** — fake: `start` returns only after `ready` exists; with `--bridge` only after
  the handshake answers (fake delays the listener 1 s; `start` takes ≥ 1 s). Process-level: run
  the built CLI's `start` in its own process group, SIGHUP that group after it exits; the VM pid
  is alive and `status` says `running`.
- **Invariant 3** — fake `neverReady` with a 2 s timeout and fake `exitEarly`: `start_failed`,
  message holds the log tail, VM pid gone, state `stopped`, no `run.json`, image bytes unchanged.
  Real: an image saved with a forked busy loop at priority 40 (`trap-robustness.md` recipe)
  gives `start_failed` within the timeout.
- **Invariant 4** — `start nope` → `not_found`, no spawn (fake VM invocation log empty).
- **Invariant 5** — second identical `start` → ok `alreadyRunning`, same pid, one invocation.
  Running headless then `start` (GUI), running without bridge then `--bridge`, and an untracked
  holder (a child with the `.changes` file open) → `instance_running` with a stop hint.
- **Invariant 6** — `portInUse` against holders bound to `127.0.0.1`, `0.0.0.0`, `::` and `::1`
  (Node `net.createServer` in the test) → true; nothing bound → false. `start --bridge` with a
  foreign holder → `port_in_use`, no VM spawned; with another fake-VM instance bridged on the
  port → the message names that instance.
- **Invariant 7** — two concurrent `start --bridge` on different instances (20 iterations, as the
  lock race test does): exactly one `running`, one `port_in_use` naming the other.
- **Invariant 8** — real: `start --bridge`, `stop --save`, `start --bridge` again; `lsof -a -p
  <pid> -iTCP:<port> -sTCP:LISTEN` shows exactly one listener at once and again after 12 s (past
  the resumed listener's ~9.5 s re-listen, `bridge-loading.md`).
- **Invariant 9** — real: the image saved with a running bridge, started without `--bridge`; no
  listener on the port right after `start` and after 12 s.
- **Invariant 10** — `processControl` tests: `signalVm` on a pid whose start time differs (a
  live `sleep` child with a forged record) sends nothing. `start --bridge` against a foreign
  holder leaves it alive. `stop` with an untracked holder that is not `Squeak` (a `node` child
  with the `.changes` file open) refuses and leaves it alive. Static check: `process.kill` appears
  only in `processControl.ts` and `launcher.ts`.
- **Invariant 11** — fake with `onTerm: save`: `stop` → "stopped, not saved", VM gone, image
  bytes unchanged (SIGKILL means the trap never ran). `onTerm: ignore` → still stops at once.
- **Invariant 12** — fake `onTerm: save` → "stopped, saved", image changed. `onTerm: ignore` with
  a 1 s save timeout → `not_saved`, VM gone within ~1 s plus the kill wait, image unchanged.
  `onTerm: slowSave` past the timeout → waits, reports saved. Real: `stop --save` on an idle
  armed instance → saved.
- **Invariant 13** — real: boot the instance image once with `spawnVm` and a script that loads
  SignalTrap and forks a ticker appending to `files/tick`, SIGTERM it (saved). `cuisctl start`:
  `tick` grows. `cuisctl stop --save`, `cuisctl start`: it grows again.
- **Invariant 14** — `stop` on a stopped instance → `already_stopped`; with a stale `run.json`
  (dead pid) the file is gone afterwards.
- **Invariant 15** — fake VM spawned directly (no record) → `stop` ends it; state `stopped`.
- **Invariant 16** — snapshot `files/` (names, mtimes, contents) before and after `stop` and
  `stop --save`: identical. Real: compile a method in a started instance via a pre-saved
  ticker-style script, `stop`; `files/UserChanges/*.user.changes` still holds it.
- **Invariant 17** — fake `ready` with `armed=false`: `status` shows `save on stop: unavailable`;
  `stop --save` → `not_saved` "save on stop unavailable" without sending SIGTERM (fake records
  received signals). Real: the plugin-less VM copy from `probes/q17` (scratch copy of `dist/`,
  `UnixOSProcessPlugin.bundle` removed) gives `armed=false`.
- **Invariant 18** — hold `locks/<name>.lock` from a child process: `start`, `stop` → `busy`
  at once (under 1 s), `status` succeeds and is unchanged. Two concurrent `stop`s on one instance
  → one result, one `busy`.
- **Invariant 19** — `start` on instance A while B's lock is held → succeeds.
- **Invariant 20** — instance whose `instance.json` has `cuisKey: "7.7-0000000"` → `start` gives
  `version_mismatch` naming both versions, no spawn; `status` reports the version; `stop` still
  works.
- **Invariant 21** — real: after `start --bridge`, a test client sends the handshake with
  `protocol_version: 3` (the value in `mcp-bridge/server/src/protocol.ts:13`, read by the test,
  not by `src/`) and one `list_categories` request; both succeed. `npm test --prefix
  mcp-bridge/server` passes unchanged.
- **Invariant 22** — image checksum before and after: plain `stop` (fake and real), every
  `start_failed` case above, and `stop --save` with `onTerm: ignore`. All unchanged.
- **Part 01 regressions (4, 5, 13, 21, 27)** — existing `runCli.test.ts` process-level tests
  extended to `start`/`stop` (no stdin read, same output from any cwd, canary HOME untouched);
  the `status` snapshot test (part 01 inv 21) gains a running fake instance and a held
  instance lock; `staticChecks.test.ts` keeps the bridge-folder and import bans.

## Risks and mitigations

- **Save cut off mid-write.** SIGKILL during `saveAndQuit` corrupts the image. Mitigated by the
  extension while the image file changes; residual risk if a save starts after the timeout
  check. Saves observed: ≤ 0.35 s.
- **TOCTOU on the port.** A process outside `cuisctl` can bind 6789 between the check and the
  bridge's bind; the bridge then falls back to all interfaces (issue #10). The bridge lock covers
  `cuisctl` races only. The loopback-only `lsof` check in start step 7 turns that case into
  `start_failed`, and the VM is killed.
- **GUI start-script modals.** In GUI mode an unsatisfied requirement opens a modal `inform:`
  instead of failing; the start timeout turns it into `start_failed`.
- **`::1`-only listeners.** Research tested `::` dual-stack, not `::1`-only; the `::1` connect is
  added for invariant 6 and covered by the unit test above.
- **Long start timeout for busy images.** 60 s is generous for a stuck image; it is injectable
  and could become a `--timeout` flag later.

## Follow-ups

- Part 01 invariant 26 (whole tool macOS-only) is still open; part 02 assumes yes, matching
  invariant 17.
- The bridge's all-interfaces fallback (GitHub issue #10) would remove the TOCTOU risk above.
- A corrupt `run.json` still raises a raw parse error (part 01 logbook open item); `start`/`stop`
  could treat it as stale.
