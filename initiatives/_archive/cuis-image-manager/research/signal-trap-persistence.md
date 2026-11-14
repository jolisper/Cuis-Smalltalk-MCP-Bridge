---
started: 2026-11-09
updated: 2026-11-10
---

## Question

Does a `startUp:` hook re-register the SIGTERM save trap after a save and relaunch, and do
class-side hooks survive a save? (Agenda question 1; also bears on question 2 and partly on
question 5.)

## Context

An earlier session (2026-11-04 to 11-06) showed that a SIGTERM trap calling `saveAndQuit` works
in headless and GUI images, and inferred that the trap must be re-registered at each start
because the VM's signal handler and external-semaphore index are not saved. Persistence of the
trap across a relaunch was untested (see `tmp-cuis-image-manager-research.md`, section E, Open
questions). Research ran 2026-11-09 on macOS (Darwin 25.6, arm64), Cuis 7.8, shared VM
`~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CuisVM.app`. Experiments used scratch copies of the
pristine base image, headless. Scripts and logs are in the session scratchpad
`/private/tmp/claude-501/-Users-jolisper-Source-Cuis-Smalltalk-MCP-Bridge/4a067712-58f9-49e9-ab4d-65ce3b79ebe4/scratchpad/q1/`
(not committed).

## Findings

- [tested] A class registered with `Smalltalk addToStartUpList:` has its class-side
  `startUp:` run on relaunch, and the class variables set by it survive saves. Setup ran
  `SignalTrapProbe install`, `Smalltalk addToStartUpList: SignalTrapProbe`, `saveAndQuit`
  (`q1/H/setup.log`, exit 0). Relaunch 1 printed `IDLE startUps=1 installed=true`; relaunch 2
  (of the image saved by relaunch 1) printed `startUps=2` (`q1/H/relaunch.log`).
- [tested] With the hook, the trap works after a relaunch. SIGTERM sent 10 s after boot gave
  exit 0, a changed image md5, and a new `----QUIT----` line in the log, in both relaunches
  (`q1/relaunch.sh H`: `rc=0 image_changed=yes`).
- [tested] Without the hook, the trap is dead after a relaunch. Image N had the trap installed
  and saved but no `addToStartUpList:`. On relaunch the hook never ran (`startUps=nil`) and
  SIGTERM ended the VM with exit 143 and an unchanged image (`q1/relaunch.sh N`:
  `rc=143 image_changed=no`). This confirms the earlier inference. `installed=true` also
  printed for N, so a saved class variable is not evidence that the trap is live.
- [tested] The same cycle works in the live GUI image (user ran the recipe in the Workspace;
  startUp list checked in the image). `Smalltalk addToStartUpList:` stores class names as
  symbols: `SystemDictionary classPool at: #StartUpList` printed
  `an OrderedCollection(#Delay #DisplayScreen #Cursor #InputSensor #ProcessorScheduler
  #EphemeronFinalizationProcess #NetNameResolver #SignalTrapProbe)` (user screenshot, session
  image 7). Cycle: `kill -TERM 49014` -> gone in 1 s, image 20,795,736 -> 20,966,704 bytes,
  `.changes` ended `----QUIT----(9 November 2026 18:17:20)`. Relaunch (PID 6465): the bridge
  listened on 6789 after 7 s with nobody calling `startOn:`, `get_vm_version` answered through
  the bridge, and `SignalTrapProbe startUps` printed `1` (user screenshot, session image 10).
  Second `kill -TERM 6465` -> gone in 1 s, image 20,966,704 -> 20,973,120 bytes, `.changes`
  ended `----QUIT----(9 November 2026 18:26:35)`. So the hook re-registers the trap in a GUI
  image and SIGTERM saves again.
- [tested] Launching a GUI image from a directory that holds only the image files shows
  "Could not find a CoreUpdates folder / No updates loaded" (user screenshot, session image 9);
  it did not stop the image, the hook or the bridge from working.
- [inferred] A stop command should not send SIGTERM in the first moments of a boot: the trap
  exists only once the image has booted and run `startUp:`. The 10 s delay in the test was
  arbitrary; the minimum safe delay was not measured.
- [tested] Recipe that worked (class `SignalTrapProbe`, scripts `q1/common.st`,
  `q1/setup-H.st`):

  ```smalltalk
  Object subclass: #SignalTrapProbe instanceVariableNames: '' classVariableNames: 'Sema Handler StartUps Installed' poolDictionaries: '' category: 'Probe'.
  SignalTrapProbe class compile: 'forward: sigNum toSemaphoreIndex: idx
  	<primitive: ''primitiveForwardSignalToSemaphore'' module: ''UnixOSProcessPlugin''>
  	^ self primitiveFailed'.
  SignalTrapProbe class compile: 'install
  	| idx |
  	Handler ifNotNil: [ Handler terminate ].
  	Sema := Semaphore new.
  	idx := Smalltalk registerExternalObject: Sema.
  	self perform: #forward:toSemaphoreIndex: with: 15 with: idx.
  	Handler := [ Sema wait. Smalltalk saveAndQuit ] forkAt: Processor userBackgroundPriority.
  	Installed := true'.
  SignalTrapProbe class compile: 'startUp: resuming
  	StartUps := (StartUps ifNil: [ 0 ]) + 1.
  	resuming ifTrue: [ self install ]'.
  Smalltalk addToStartUpList: SignalTrapProbe.
  ```

  `install` was meant to end the saved handler Process before creating a new one. Correction
  (2026-11-10, `signal-trap-class.md`): `forkAt:` answers `nil` in Cuis, so `Handler` was always
  nil and the terminate never ran. Saved handlers do not pile up anyway (tested there).
- [tested] Headless `-s` scripts print nothing unless the script starts with
  `Transcript logToStdout: true.` A run without it exited 0 and the log held only the macOS
  `ApplePersistenceIgnoreState` line (`q1/T/t1.log`). `mcp-bridge/image/run-tests.st:3` uses
  `Transcript logToStdout: true.`
- [tested] A `| cls |` temp declaration placed after earlier statements in a `-s` script made
  the run hang silently until killed at 60 s, with no log lines and an unchanged image (first
  and second setup attempts for H and N). Removing the temp and referencing the class by name
  fixed it (`q1/H/setup.log`: exit 0). Only the combination was observed; the exact cause
  (parser prompt vs. something else) was not isolated.
- [tested] Compiling a method with a stray `;` inside a primitive pragma
  (`module: ''UnixOSProcessPlugin'';>`) also hung a headless run: markers A to D printed,
  E never (`q1/T/t2.log` first run). Without the `;` all markers printed and exit was 0.
- [tested] A bare undeclared class name in a `-s` script did not hang by itself. The log showed
  `UndefinedObject>>DoIt (SignalTrapProbe is Undeclared)` and the script continued to the next
  markers (`q1/T/t2.log`). Partial evidence for the agenda's undeclared-name question: that
  run also had author name set, so it shows no hang in that configuration only.
- [tested] `timeout` is not available in this macOS shell (`command not found`, rc 127).
  Experiment scripts use a background watchdog (`sleep N; kill -9`) instead
  (`q1/run.sh`).

## Rejected / dead ends

- First setup scripts (declaring `| cls |` mid-file, then a stray `;` in the pragma) hung with
  no output; two reruns were spent before bisecting with minimal scripts (`q1/t1.st`,
  `q1/t2.st`).

## Conclusion

A `Smalltalk addToStartUpList:` entry whose `startUp:` re-installs the trap restores
save-on-SIGTERM after every relaunch, tested over two consecutive relaunches. Without the hook
the trap is dead after the first relaunch and SIGTERM kills the VM without saving. Class-side
state and the start-up list entry survive a save. The same holds in a live GUI image, tested
over a full install, save, relaunch, SIGTERM-save cycle. The prototype is a probe class, not a
packaged loadable class.

## Open questions

- ~~Minimum time after boot before the trap is live?~~ About 0.2–0.3 s headless (tested) in
  `signal-trap-class.md`. GUI not measured.
- ~~Does omitting `Handler terminate` let saved handler Processes accumulate?~~ No (tested) in
  `signal-trap-class.md`.
- ~~Trap robustness under a busy higher-priority Process and during Morphic operations~~
  Tested in `trap-robustness.md`.
- ~~Exact cause of the silent hang for a mid-file `| cls |` declaration~~ A temp declaration
  that is not on the first line is a syntax error, and any syntax error hangs the run before
  any statement executes (tested) in `headless-pitfalls.md`.

## Sources

- `tmp-cuis-image-manager-research.md` (earlier findings and the original trap recipe)
- `mcp-bridge/image/run-tests.st:3`
- `tools/run-headless-tests.sh` (headless launch invocation)
- Session experiment scripts and logs under
  `/private/tmp/claude-501/-Users-jolisper-Source-Cuis-Smalltalk-MCP-Bridge/4a067712-58f9-49e9-ab4d-65ce3b79ebe4/scratchpad/q1/`
  (`common.st`, `setup-H.st`, `setup-N.st`, `idle.st`, `run.sh`, `relaunch.sh`, `t1.st`, `t2.st`)
