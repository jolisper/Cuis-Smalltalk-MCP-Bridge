---
started: 2026-11-10
updated: 2026-11-11
---

## Question

How does the SIGTERM trap behave when a busy Process runs at a higher priority, and while
Morphic is in the middle of an operation? (Agenda question 3.)

## Context

The `SignalTrap` package (`probes/q11/SignalTrap.pck.st`) runs its handler at
`userBackgroundPriority` (30). `stop-semantics.md` showed that a busy script at priority 40
starves it. Research ran 2026-11-10 on macOS 25.6, Cuis 7.8, VM `7.20260327.1636`. Two armed
images were used: `h30`, the package as it is, and `h60`, the same package with the handler at
`lowIOPriority` (60) (`setup-h60.st`). Each busy probe forks `[ true ] whileTrue: [ 3 + 4 ]` at a
given priority, sends SIGTERM 3–4 s after boot, and SIGKILLs at the watchdog. Scripts and logs
are in `probes/q15/`. The image copies were deleted after the runs.

Cuis priorities, as evaluated with `run_smalltalk` (`Processor perform:` on each name):
`lowestPriority -> 10 . systemBackgroundPriority -> 20 . userBackgroundPriority -> 30 .
userSchedulingPriority -> 40 . userInterruptPriority -> 50 . lowIOPriority -> 60 .
highIOPriority -> 70 . timingPriority -> 80`. The bridge's poll and listener Processes run at
`highIOPriority` (`McpBridgeServer class>>startOn:`, `ConnectionQueue>>initPortNumber:queueLength:`).
`-s` scripts log as `process:40` (every probe log).

## Findings

- [tested] Headless matrix of busy priority against handler priority (`h30-busy-*.log`,
  `h60-busy-*.log`):

  | busy at | handler 30 | handler 60 |
  |---|---|---|
  | 20 | saved (rc 0) | saved |
  | 30 | **not saved**, SIGKILL (rc 137) | saved |
  | 40 | **not saved**, SIGKILL | saved |
  | 50 | **not saved**, SIGKILL | **not saved**, SIGKILL |

  The trap works only when its handler runs above the busy Process. [inferred] At equal
  priority it starves because the scheduler does not preempt a running Process for another
  Process of the same priority, which matches the busy-30 result.
- [documented] `saveAndQuit` does its work in a Process forked at `timingPriority - 1` (79)
  (`SystemDictionary>>snapshot:andQuit:embedded:clearAllClassState:`). Before that fork it runs
  `garbageCollect` and `EphemeronFinalizationProcess ensureFinalizationComplete` in the
  handler's own Process. [inferred] The busy-at-50 failure with a priority-60 handler comes from
  this pre-fork step waiting on a Process at or below 50. It was not traced.
- [tested] GUI, with the UI process itself busy (`-s` script `[ true ] whileTrue: [...]`;
  [inferred] in a GUI start the `-s` file runs in the UI process.
  `snapshot:andQuit:embedded:clearAllClassState:` says "Some command line arguments need to be
  processed after the UI is up, and in the UI process", but whether `-s` is one of them was
  not traced). With handler 30 the image was not saved and needed SIGKILL.
  With handler 60 it saved in 0.05 s (`h30-gui-ui-busy.log`, `h60-gui-ui-busy.log`).
- [tested] GUI with a modal dialog open (`PopUpMenu inform:` from the `-s` script). With handler
  30 the image saved in 0.07 s. The saved image relaunched and saved again on SIGTERM
  (`h30-gui-modal*.log`). A modal loop idles the UI process, so the trap runs.
- [tested] A busy loop in a **forked** Process is saved with the image and resumes on relaunch.
  The relaunched `h60` busy-40 image ran at 100% CPU at 3 s, and its `-s` script never ran. The
  trap at 60 still saved it on SIGTERM (`h60-busy-40-relaunch.txt`).
- [tested] A busy loop in the **UI process** does not come back. The relaunched GUI image saved
  with a busy UI ran at 1.9% CPU, and its `-s` script ran (`h60-gui-ui-busy-relaunch.txt`).
  [documented] The snapshot stops the UI process and starts a new Morphic process at start-up
  (`UISupervisor stopUIProcess`, `spawnNewMorphicProcessFor:`).
- [tested] The readiness file catches a start script starved by a resumed busy Process
  (2026-11-11, `probes/q17/ready.txt`). An armed image with the handler at 60 and a forked
  busy loop at 40 was saved by SIGTERM, then relaunched with a start script that writes
  `cuis.ready`: after 5 s the file was absent and the VM ran at 98.7% CPU. The same script on the
  armed image without the busy loop wrote the file (1.6% CPU).
- [inferred] At priority 60, the handler can save while a priority-40 operation is half done,
  for example a Morphic layout pass or a file write. The image then holds that partial state.
  The UI process is replaced on relaunch, but forked Processes resume where they stopped. At
  priority 30, the save happens only when user-level work is idle, and the cost is that busy
  work blocks the save entirely.

## Options

Handler priority for `SignalTrap`:

- **30, user background (as now).** Saves only at idle points, so the state is consistent.
  Busy user code (a long Workspace do-it, a runaway loop) blocks the save, and `stop` escalates
  to SIGKILL with no save.
- **60, low IO (tested).** Saves through any user-level busy work (≤ 40), including a busy UI.
  The image can be saved in the middle of an operation, and a runaway forked Process is saved
  and resumes at every relaunch.
- **Both: 30 first, then 60.** Not prototyped. For example, `stop` sends SIGTERM, and the trap
  raises its own priority after a grace period if no idle point came.

## Rejected / dead ends

- Saving the busy image for the readiness test with `saveAndQuit` from the start script after
  forking the busy loop at 40. The busy loop starved the script itself and the save never
  happened (rc 137, image unchanged; first `busy` run in `probes/q17/`, log overwritten by the
  rerun, seen in the session output only). The image was then
  saved through the priority-60 trap instead.

## Decisions

- Decision (user): the `SignalTrap` handler runs at `lowIOPriority` (60) — because a save the
  user asked for should happen even while user code (priority 40 or lower, including a busy
  UI) is running. Accepted caveats: the save can land mid-operation, and a runaway forked
  Process is saved and resumes on relaunch; `start`'s readiness check detects that (tested in
  this file) and reset recovers from it. (Recommended by Claude, accepted by the user 2026-11-11.)

## Conclusion

The trap works only when its handler's priority is above whatever is busy. At the package's
current 30, any busy user code at 30 or above, including a busy UI process, swallows SIGTERM,
and only SIGKILL stops the VM. At 60 it saves through all user-level work, but not through busy
work at 50. A modal Morphic dialog does not block the trap. Saving through busy work has a
cost: a busy forked Process is saved and resumes at every relaunch, pinning the CPU and starving
the start script. A busy UI process is replaced at relaunch. `stop`'s SIGKILL escalation stays
necessary at any priority. Which priority to ship is a design decision: 30 gives consistent
saves, 60 gives saves that always happen.

## Open questions

- ~~Which handler priority to ship~~ 60 (see Decisions).
- ~~What `ensureFinalizationComplete` waits on when a Process at 50 is busy~~ Out of scope:
  the busy-at-50 result is what matters for the design, and `stop`'s SIGKILL covers it.
- ~~Does the readiness file catch a start script starved by a resumed busy Process?~~ Yes
  (tested, see Findings).

## Sources

- `probes/q15/` (scripts, logs)
- `probes/q17/ready.st`, `ready.txt`, `ready-*.log`, `busy-h60.log`, `busy-save.log`
- `ProcessorScheduler` priority names (live image; values via `run_smalltalk`)
- `SystemDictionary>>saveAndQuit`, `>>snapshot:andQuit:embedded:clearAllClassState:`,
  `ChangeSet class>>zapAllChangeSets` (live image via the MCP bridge)
- `signal-trap-class.md`, `stop-semantics.md`
