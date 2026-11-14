---
started: 2026-11-04
updated: 2026-11-10
---

## Question

How do Cuis images save, stop and relaunch (signals, processes, sockets, the changes file), and
which tested recipes exist for saving an image from outside? Out of scope: defects in the MCP
bridge itself (the `stop` listener leak, the stale MCP config path).

## Context

Images are launched, restarted and cleaned up by hand, and the MCP bridge needs a reliable live
image. The shared Cuis home already holds a pinned distribution and a pristine base image.
Research ran 2026-11-04 to 2026-11-06 on macOS (Darwin 25.6, arm64) against Cuis 7.8 and the
shipped VM `7.20260327.1636`. Experiments used scratch copies of the frozen base image, headless
unless stated. Scripts and logs live in the session scratchpad (`<scratchpad>` below) and are not
committed. `<scratchpad>` is
`/private/tmp/claude-501/-Users-jolisper-Source-Cuis-Smalltalk-MCP-Bridge/b91223dd-f383-4315-a0ad-01556b852630/scratchpad/` (found already purged on 2026-11-10; the `e*` scripts and logs are lost, so these
findings rest on this record only).

Migrated 2026-11-10 from `tmp-cuis-image-manager-research.md` (section E, verbatim, plus the
items below from sections C and D). Later research supersedes parts of it:
`signal-trap-persistence.md` (trap persistence across relaunch, `startUp:` hooks) and
`launch-layout.md` (where Cuis finds `CoreUpdates` and `Packages`).

## Findings

Evidence tags: `tested` = run in this session, `documented` = read from a file or source,
`inferred` = own reasoning.

### Existing layout and constraints

- [tested] The shared home keeps the VM distribution and a pristine base apart — session command
  `ls ~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/{base,dist}`: base holds `Cuis7.8.changes`,
  `Cuis7.8.image`, `Cuis7.8.sources`; dist holds `CoreUpdates`, `CuisImage`, `CuisVM.app`,
  `Packages`, `RunCuisOnMac.sh`.
- [documented] Headless tests run on a throwaway copy of a frozen base because a shared working
  image was corrupted once — `tools/run-headless-tests.sh:2-8` "never the shared, mutable working
  image under Cuis7-8-main/CuisImage/, which an interactive session can corrupt (as happened on
  2026-09-04: a hung "save" left it half-written".
- [documented] The bridge's port is fixed, one connection at a time — `mcp-bridge/PROTOCOL.md:25`
  "Port: `6789`, fixed and hardcoded on both sides"; `:36`. Inference: at most one image can be
  reached by the MCP tools at a time.
- [documented] The existing skill avoids the live port —
  `.claude/skills/run-cuis-mcp-bridge/SKILL.md:16` "Never kill whatever is listening on `6789` —
  check first."
- [tested] The live GUI image ran from the pinned shared VM — `ps -p 9707 -o command`:
  `/Users/jolisper/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app/Contents/MacOS/Squeak
  <scratchpad>/gui/Cuis7.8.image -u`. This corrects an earlier assumption that it used
  `Cuis7-8-main/CuisVM.app`.

### Saving and the changes file

- [tested] `Smalltalk saveAndQuit` from a `-s` script saves and exits 0 — `<scratchpad>/e2/save.st`:
  exit=0, image grew 19,791,248 to 19,852,568 bytes. A relaunch printed `ProbeVal=42`,
  `ProbeClass=ProbeClass`, `hello='hi'` (`<scratchpad>/e2/check.st`).
- [tested] `Smalltalk saveImage` from a background process saves and keeps the process alive —
  `<scratchpad>/e3/watch.st` (flag file `save.flag`): log `SAVING`, image md5 changed,
  `alive: yes`, relaunch printed `ProbeVal=99`. The expected `SAVED` log line did not appear; not
  investigated (inferred: logging may reset after a snapshot).
- [tested] `SystemDictionary` has `saveAndQuit`, `saveAs:`, `saveImage`,
  `saveAndQuitAs:clearAllClassState:`, `quit`, `quitPrimitive:` — `<scratchpad>/e1/probe.st` output.
- [tested] Each startup appends a `STARTUP` line and a clean `saveAndQuit` appends `QUIT` to
  `.changes` — tail: `----QUIT----(4 November 2026 21:52:56) Cuis7.8.image priorSource: 68!` then
  `----STARTUP---- (4 November 2026 21:53:03)`.
- [inferred] A kill leaves `STARTUP` without `QUIT`, from the signal runs where `.changes` gained
  only startup entries.

### Signals

- [tested] Killing never saves. 14 signals were sent to headless runs (`<scratchpad>/e3`, `/e5`);
  the image file stayed byte-identical to the base (`md5` unchanged / `cmp` "unchanged").
  - SIGTERM and SIGHUP end the process at once (`TERM: exited rc=143`, `HUP: exited rc=129`).
  - SIGUSR1 stays alive and prints a stack dump; INT, QUIT, TSTP, CONT, WINCH, URG stayed alive.
  - USR2 exited 134 (abort, 312 log lines), ALRM 142, PIPE 141, VTALRM 154, PROF 155.
  - Caveat: for PIPE, TSTP, CONT, WINCH, URG, VTALRM, PROF the log was empty, so the signal may
    have arrived before the script's loop started.
- [tested] The shipped VM exports signal primitives — `nm -gU .../UnixOSProcessPlugin.bundle/.../
  UnixOSProcessPlugin`: `_primitiveForwardSignalToSemaphore`, `_primitiveCanReceiveSignals`,
  `_primitiveSendSigchldTo`. [documented] Source:
  `opensmalltalk-vm/src/plugins/UnixOSProcessPlugin/UnixOSProcessPlugin.c:1995`
  `primitiveForwardSignalToSemaphore(void)` takes a signal number and a semaphore index.
- [tested] The plugin also ships for Linux and Windows — `find`: `Linux-x86_64/lib/squeak/
  7.0-202603271636-64bit/UnixOSProcessPlugin.so`, `Linux-arm64/...`, and
  `Windows-x86_64/Win32OSProcessPlugin.dll`. Whether the Win32 plugin supports POSIX signals was
  not checked.
- [tested] Stock Cuis 7.8 has no signal API — scan of the base image (`<scratchpad>/e8/find.st`):
  no class named `*Signal*`, `*OSProcess*`, `*Unix*`, `*Interrupt*`, `*Posix*`, and no method
  mentioning `UnixOSProcess`, `ForwardSignal` or `SIGTERM`. Same in the live image through the
  bridge: `list_senders_of forwardSignal:toSemaphoreIndex:` returned `[]`.
  `registerExternalObject:` exists in `SystemDictionary`, `ExternalObjectTable` and
  `ExternalSemaphoreTable`; `get_loaded_modules` did not list `UnixOSProcessPlugin` before first
  use.
- [tested] A SIGTERM-to-save trap works in plain Smalltalk — `<scratchpad>/e6/trap2.st`. Result:
  log `GOT SIGTERM, saving`, `----QUIT----`, `exited rc=0`, image md5 changed, relaunch printed
  `ProbeVal=77`. Recipe (signal 15 = SIGTERM; `perform:` avoids the Workspace unknown-selector
  prompt, see below):

  ```smalltalk
  | cls sema idx |
  cls := Object subclass: #SignalTrapProbe instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'Probe'.
  cls class compile: 'forward: sigNum toSemaphoreIndex: idx
  	<primitive: ''primitiveForwardSignalToSemaphore'' module: ''UnixOSProcessPlugin''>
  	^ self primitiveFailed'.
  sema := Semaphore new.
  idx := Smalltalk registerExternalObject: sema.
  cls perform: #forward:toSemaphoreIndex: with: 15 with: idx.
  [ sema wait.
    Transcript show: 'SIGTERM trapped, saving'; newLine.
    Smalltalk saveAndQuit ] forkAt: Processor userBackgroundPriority.
  ```

  A headless script needs `Utilities setAuthorName: 'Probe' initials: 'prb'.` before the compile
  (see Headless pitfalls).
- [tested] The trap also works in a live GUI image — SIGUSR1 handler wrote `SIGUSR1 trapped in live
  image` to `<scratchpad>/live-probe.txt` and the VM stayed alive. SIGTERM handler: after
  `kill -TERM 9707` the process was gone within 2 s, the image went from 19,791,248 to 20,795,736
  bytes, `.changes` ended `----QUIT----(5 November 2026 14:05:32)`, and a relaunched copy printed
  `Class=SignalTrapProbe`, `Method=true`. Transcript showed `SIGTER…` then `----Q…` after relaunch
  (user screenshot, session image 4).
- [tested] In a Workspace the whole selection compiles before any line runs, so calling a method
  defined earlier in the same selection raised "Unknown selector, please confirm, correct, or
  cancel" (user screenshot, session image 3). The `perform:` form ran without it in headless; the
  Workspace prompt was not re-tested with it.

### Processes and sockets across a save

- [tested] A snapshot saves Processes; a relaunched image resumes them — `<scratchpad>/e11` (port
  6791): packages loaded, `startOn: 6791`, `saveAndQuit`; relaunch with an idle script that never
  calls `startOn:`: listeners 0 at t=1, 3, 6 s and 1 at t=9 s; handshake reply
  `{"ok": true, "result": {"protocol_version": 3}}`.
- [tested] The same happened in the live GUI image: after the SIGTERM save and relaunch of PID 49014
  at 14:07:23, `lsof` showed `Squeak 49014 ... TCP 127.0.0.1:6789 (LISTEN)`. User: "I didn't start
  the bridge again. You only restart the image."
- [documented] The listening socket does not survive; the loop recreates it —
  `mcp-bridge/image/MCP-Bridge.pck.st:351-355` `socket isValid ifFalse: [ socket destroy. (Delay
  forMilliseconds: 10) wait. ^self listenLoop ]`, with `:357` `waitForAcceptFor: 10`. The method
  is a copy of the stock one — `:338` "Modified copy of ConnectionQueue>>listenLoop
  (Network-Kernel)". Whether the re-listen branch matches stock was not diffed.
- [documented] The bridge keeps its queue and process in class-side state — `:391`
  `connectionQueue := McpBridgeConnectionQueue portNumber: aPort queueLength: 5.` and `:394`
  `pollProcess := [self pollLoop] newProcess.` A grep for `startUp|shutDown|addToStart` in
  `MCP-Bridge.pck.st` returned nothing, so it uses no hooks.
- [tested] The image offers start-up and shut-down hooks — scan of `SystemDictionary` selectors:
  `addToStartUpList:`, `addToStartUpList:after:`, `addToShutDownList:`, `removeFromStartUpList:`,
  `doStartUp:`, `processStartUpList:`, `processShutDownList:`, `startUpArguments`. Whether a class
  in these lists receives `startUp:`/`shutDown:` was not run.
- [inferred] A signal trap's handler Process is saved but the VM's signal handler and the
  external-semaphore index are not, so a trap must be re-registered at each start. Based on the
  Process/OS-resource split above, not on a direct test.

### Headless pitfalls

- [tested] Without `Utilities setAuthorName:` a compile in a headless script hangs — `e9/run2.st`
  hung with no `COMPILED` line; after adding `Utilities setAuthorName: 'Probe' initials: 'prb'.` it
  printed `COMPILED`, `FORWARDED`, `INSTALLED`.
- [tested] After crash-like exits macOS blocks the next launch with a modal alert — `sample` of a
  hung VM: `-[NSPersistentUIRestorer promptToIgnorePersistentStateWithCrashHistory:]` ->
  `-[NSAlert runModal]`; `Squeak` at 0% CPU, no log output. `-ApplePersistenceIgnoreState YES`
  before `-headless` failed (`unknown option: -ApplePersistenceIgnoreState`); after the script
  argument (`-s <script> -ApplePersistenceIgnoreState YES`) the VM booted and ran. [inferred] The
  hang came from earlier `kill -9` and abort exits (a Squeak crash report existed in
  `~/Library/Logs/DiagnosticReports/`).
- [tested] A GUI image started from a directory holding only the image files shows "Could not find
  a CoreUpdates folder / No updates loaded" — user screenshot, session image 4; the relaunch used
  `<scratchpad>/gui/`. Where Cuis looks for `CoreUpdates` was not checked.

### From the earlier Obsidian notes (sections C and D of the tmp file)

- [inferred] Design rule for a service that must survive save and relaunch: either the owning
  Process checks its OS resource and rebuilds it when invalid (as the bridge's `listenLoop`
  does), or the class registers `startUp:`/`shutDown:` hooks that re-create and release it; never
  rely on one-shot setup that runs once per image lifetime — Obsidian note 202611061039, "Rule
  for designing a service".
- [inferred] Calling `startOn:` again in a relaunched image whose saved state already had the
  server running creates a second listener — same note, "Why it happens".
- [documented] Out-of-scope bridge defect that affects how images are started:
  `McpBridgeServer class>>stop` terminates the poll process and calls `connectionQueue destroy`,
  but the queue's listening socket stays bound, so after a stop/start cycle in one image there
  are two listeners on 6789 and the client reports `unreachable: Connect timed out`. Workaround:
  relaunch the image and run `startOn:` exactly once — Obsidian note 202611040113, "Related bug
  found while debugging".

## Options

Ways to save an image on stop, as found:

- **No save.** SIGTERM, then SIGKILL after a timeout. Nothing to load; unsaved image changes are
  lost (code edits stay in `.changes`).
- **SIGTERM trap (recipe above).** No polling process; needs the trap loaded in the image and
  re-registered at each start (inferred).
- **Flag-file watcher** (`e3/watch.st`, tested). No plugin dependency; needs an in-image polling
  process.
- **A reusable `SignalTrap` class with a start-up hook.** Prototyped and tested in
  `signal-trap-class.md`.

## Rejected / dead ends

- Sending signals to trigger a save with no image support — none of 14 signals saves.
- Asking the image to save through the bridge — the live channel is read-only —
  `mcp-bridge/PROTOCOL.md:15` "exposes **read-only reflection only**"; this would need an
  evaluation op.
- The first trap tests hung for two reasons that were not what I first thought: the macOS alert (no
  boot at all) and the missing author name (compile prompt). I had attributed a hang to undeclared
  class names; no run isolated that cause (see Open questions).

## Conclusion

Processes resume after a save; OS resources (sockets, handlers, external semaphores) do not. A
SIGTERM trap that calls `saveAndQuit` works in headless and GUI images with no VM change. Stock
Cuis has no signal API, only the registration primitive and start-up hooks. Persistence of the trap
across a relaunch is untested.

## Open questions

- ~~Does a bare undeclared class name in a headless `-s` script hang on a prompt?~~ No (tested)
  in `headless-pitfalls.md`. Original note: Earlier notes
  claimed it, but the runs that appeared to show it also lacked `setAuthorName:` or ran during the
  macOS alert. Needs an isolated test.
- ~~Is the bridge's re-listen branch identical to stock `ConnectionQueue>>listenLoop`?~~ Yes,
  apart from the loopback `interface:` argument (documented) in `bridge-loading.md`. Original note: Needs a diff
  against Network-Kernel.
- ~~Does a `startUp:` hook re-register the trap after a relaunch, and do class-side hooks survive
  a save?~~ Resolved (tested) in `signal-trap-persistence.md`.
- ~~Does the SIGTERM trap behave under a busy higher-priority Process, or while Morphic is
  mid-operation?~~ Tested in `trap-robustness.md`. Linux was not tested.
- ~~Where does Cuis look for `CoreUpdates` and `Packages` relative to the image?~~ Resolved
  (tested) in `launch-layout.md`.
- ~~What causes two listeners on 6789 after a restart in one image~~ A resumed saved server plus a
  new `startOn:` (tested) in `bridge-loading.md`. Original question: the orphan socket in
  `McpBridgeServer class>>stop`, a resumed saved server plus a new `startOn:`, or both? Observed
  twice; cause not isolated. Bridge defects are out of scope; recorded only because it affects how
  images are started.
- ~~Does the Windows `Win32OSProcessPlugin` support signals?~~ Out of scope: the agenda
  excludes Linux and Windows signal support.

## Sources

- `tools/run-headless-tests.sh`
- `mcp-bridge/PROTOCOL.md`
- `mcp-bridge/image/MCP-Bridge.pck.st`
- `.claude/skills/run-cuis-mcp-bridge/SKILL.md`
- `opensmalltalk-vm/src/plugins/UnixOSProcessPlugin/UnixOSProcessPlugin.c`
- `~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/` (listing)
- Live image queries through the `cuis-mcp-bridge` MCP tools (`list_categories`,
  `list_senders_of`, `list_implementors_of`, `get_loaded_modules`, `get_class_definition`,
  `get_method_source`)
- Session experiment scripts under `<scratchpad>` (`e1`, `e2`, `e3`, `e5`, `e6`, `e8`, `e9`, `e11`)
- User screenshots (session images 3 and 4)
- Obsidian notes 202611040113 (Cuis Image Manager Draft) and 202611061039 (Cuis Image Start and
  Stop Semantics), via `tmp-cuis-image-manager-research.md`
