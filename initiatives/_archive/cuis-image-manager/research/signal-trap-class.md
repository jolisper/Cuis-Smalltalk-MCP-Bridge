---
started: 2026-11-10
updated: 2026-11-11
---

## Question

Can a small class with start-up and shut-down hooks deliver save-on-stop with no VM change, and
be loaded into any managed image? (Agenda question 2.) Also covers two open questions left by
`signal-trap-persistence.md`: how soon after boot the trap is live, and whether saved handler
Processes pile up across relaunches.

## Context

`signal-trap-persistence.md` showed that a probe class (`SignalTrapProbe`) on the start-up list
re-arms the SIGTERM trap at each relaunch. That probe was built from `-s` scripts, not as a
package. Research ran 2026-11-10 on macOS (Darwin 25.6, arm64), Cuis 7.8, VM
`7.20260327.1636` (`UnixOSProcessPlugin` `oscog-eem.82`, external). Probes ran headless on fresh
copies of the shared base image. Scripts, logs and the package are in `probes/q11/`. The image
copies were deleted after the runs.

## Findings

- [tested] `probes/q11/SignalTrap.pck.st` (one class, no requirements beyond `Cuis-Base`) loads
  with `CodePackageFile installPackage:` into a pristine image. Its class-side `initialize` adds
  it to the start-up list and arms the trap. A SIGTERM 8 s later saved the image and quit
  (rc 0, image changed, `----QUIT----` in the log) (`B-load-term.log`).
- [tested] It keeps working across relaunches. Load, `saveAndQuit`, then three relaunches with a
  SIGTERM 6 s after boot each: all rc 0, image changed, `armed=true`
  (`A-setup.log`, `A-relaunch1..3.log`).
- [tested] No shut-down hook is needed. Cuis clears the external objects table on every real
  start-up (`SystemDictionary>>doStartUp:` sends `clearExternalObjects` when
  `isARealStartup`), so the registered semaphore cannot accumulate across relaunches. The
  class has only a `startUp:` hook.
- [tested] Cuis `BlockClosure>>forkAt:` answers `nil` on purpose ("Do NOT answer the new
  process"). The Q1 recipe's `Handler := [ ... ] forkAt: ...` therefore always stored `nil`, and
  its `Handler ifNotNil: [ Handler terminate ]` never ran. With the same code the package
  reported `LOADED armed=false` yet SIGTERM still saved (rc 0, image changed), and
  `E-debug.log` shows `D1 true`, `D2 nil`, `E3 MessageNotUnderstood 'UndefinedObject>>isTerminated'`
  (Armed true, Handler nil). The first `B` and `C` logs were overwritten by the rerun after the
  fix; their output was seen in the session only. The package builds the Process with `newProcess`,
  `priority:` and `resume` to keep a reference.
- [tested] `primitiveForwardSignalToSemaphore` fails if the signal is already forwarded in this
  VM session: `forwardSignal:toSemaphoreAt:` answers `SIG_ERR` when `semaIndices[sigNum] > 0`
  (VM source via `get_vm_source`, `UnixOSProcessPlugin.c:1991`). Index 0 disarms and restores
  the original handler, and fails if nothing is armed. So a second `install` in the same
  session (a package reload, or a second trap class for the same signal) fails unless it
  disarms first. The package's `install` disarms (ignoring failure), then arms. Running
  `install` twice and reloading the package, then SIGTERM, gave rc 0 and a saved image, with
  `live=8` (`C-reinstall-term.log`: `REPORT armed=true live=8`). The `forkAt:` version
  reached `live=11` (first run, log overwritten; seen in the session output only).
- [tested] `uninstall` removes the class from the start-up list, ends the handler and disarms.
  SIGTERM then ended the VM with rc 143 and an unchanged image (`D-uninstall-term.log`).
- [tested] Stale handlers do not pile up across relaunches, even without `terminate`. Live
  Process counts after a GC for relaunches 1 to 3 were 9, 10, 10 with the package and 10, 10, 10
  with `install` recompiled without the terminate step (`NT-relaunch1..3.log`). [inferred] An
  old handler waits on a semaphore that nothing else references once `Sema` is replaced, so the
  pair becomes garbage. The terminate step is still kept for same-session reinstalls.
- [tested] Arming time after boot, headless, image already armed, no `-s` script, 3 runs per
  delay (`L/`). With SIGTERM at 0.05 s and 0.1 s the result was rc 143 (3 of 3 each). At 0.2 s it
  was rc 143 once and saved twice. From 0.3 s to 1 s it saved 3 of 3 each. An early SIGTERM
  is an ordinary kill: no save, and the image is untouched.
- [tested] Without `UnixOSProcessPlugin` the package stays disarmed and does no harm
  (2026-11-11, `probes/q17/`). A scratch copy of the VM with
  `Contents/Resources/UnixOSProcessPlugin.bundle` removed loaded the package with no error
  (`noplugin.log`: `NOPLUGIN armed=false startUp=true`); SIGTERM then gave rc 143 and an
  unchanged image. An image armed on the normal VM booted on the plugin-less copy with no hang
  (`armed-noplugin.log`: `BOOT armed=false`) and SIGTERM again gave rc 143.
- [inferred] A GUI boot, or a larger image, will arm later than 0.3 s. The measurement is only
  a lower bound.
- [tested] A `| h |` temp declaration after earlier statements in a `-s` script hung again
  until the 30 s watchdog killed it (first `E-debug` run, rc 137, log overwritten). This is the
  same pitfall as in Q1. An uncaught error also hung a run: the second `E-debug` run stopped
  after `LOADED`. With each step wrapped in `on: Error do:`, the third run showed
  `MessageNotUnderstood` (`nil isTerminated`). Both causes are isolated in
  `headless-pitfalls.md`.

## Options

How `cuisctl` can avoid an early SIGTERM that kills without saving:

- **Fixed delay before `stop` may signal.** Simple. Fragile, because the arming time depends on
  the GUI and the image size.
- **Readiness marker written by the image.** `install` (or the bridge start-up) writes a file
  in the instance folder once armed, and `stop` checks for it. Not prototyped.
- **Check the exit status.** rc 143 after SIGTERM means the image quit without saving. `stop`
  can report "stopped without save" rather than hiding it. Works with either option above.

## Rejected / dead ends

- The first `E-debug` probes hung (mid-file temp, then an uncaught error) before the
  error-wrapped version gave a result.
- Storing the handler from `forkAt:`. It answers `nil` in Cuis (see Findings).
- A shut-down hook to unregister the semaphore. It is not needed because Cuis clears external
  objects at start-up.

## Conclusion

Yes. A one-class package, `SignalTrap.pck.st`, gives save-on-SIGTERM with no VM change. It loads
with `installPackage:`, arms itself on load and at every real start-up, and can be removed with
`uninstall`. It needs only a `startUp:` hook. Two details matter. First, `forkAt:` answers `nil`
in Cuis, so the handler must be created with `newProcess`. Second, the forwarding primitive
refuses to arm a signal that is already armed, so `install` must disarm first. Without that, a
reinstall in the same session leaves SIGTERM forwarded to a dead semaphore. The trap is live
about 0.2–0.3 s after a headless boot. A SIGTERM sent earlier kills the VM without saving
(rc 143).

## Open questions

- ~~Arming time for a GUI boot~~ About 0.2 s, same as headless (tested) in `stop-semantics.md`.
- ~~Arming time for an image with the bridge loaded~~ About 0.3 s, GUI and headless (tested)
  in `stop-semantics.md`.
- ~~How `stop` should learn that the trap is armed~~ A readiness file written by the start
  script, which runs after the trap is armed (tested) in `stop-semantics.md`.
- ~~Does an uncaught error hang headless `-s` runs?~~ Yes; a handler that quits with code 1
  avoids it (tested) in `headless-pitfalls.md`. What the VM waits on stays open there.
- ~~Behaviour when the VM lacks `UnixOSProcessPlugin`~~ Disarmed, no error, SIGTERM is an
  ordinary kill (tested, see Findings).

## Sources

- `probes/q11/` (package, scripts, logs)
- `SystemDictionary>>doStartUp:`, `>>send:toClassesNamedIn:with:`, `BlockClosure>>forkAt:`,
  `>>newProcess`, `CodePackageFile class>>installPackage:` (live image via the MCP bridge)
- `UnixOSProcessPlugin.c:1991-2033`, commit `759d8f20` (`get_vm_source`)
- `signal-trap-persistence.md`
- `probes/q17/` (`noplugin.st`, `noplugin.log`, `boot-mark.st`, `armed-noplugin.log`)
