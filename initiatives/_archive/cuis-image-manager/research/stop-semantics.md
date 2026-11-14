---
started: 2026-11-10
updated: 2026-11-11
---

## Question

What should `stop` do when the trap is absent or unresponsive (SIGTERM, then SIGKILL after a
timeout), and how are stale pids told from live ones? (Agenda question 6.) Also covers how
`stop` learns that the trap is armed, left open by `signal-trap-class.md`.

## Context

The `SignalTrap` package (`probes/q11/SignalTrap.pck.st`) is a SIGTERM trap that saves the
image and quits. It arms itself at every real start-up. Research ran 2026-11-10 on macOS
(Darwin 25.6, arm64), Cuis 7.8, VM `7.20260327.1636`. Every probe used a copy of one armed base
image: a pristine image with the package loaded and saved. Probes ran headless unless marked
GUI. Scripts and logs are in `probes/q12/`. The image copies were deleted after the runs.
`run.sh` reports the exit code, whether the image file changed, and the seconds from SIGTERM to
exit.

## Findings

- [tested] In an idle armed image, SIGTERM saves and quits in about 0.05 s (rc 0, image
  changed) (`U0-idle.log`). In every save in this session the exit came 0.05–0.32 s after the
  signal.
- [tested] A busy Process at user priority starves the trap. A `-s` script running
  `[ true ] whileTrue: [ 3 + 4 ]` got SIGTERM at 3 s and was still running 17 s later, when
  the watchdog's SIGKILL ended it (rc 137, image unchanged) (`U1-busy.log`). The trap's handler
  runs at `userBackgroundPriority` (30) and the script at 40, so the signal is swallowed. The
  VM neither saves nor dies. Without escalation to SIGKILL, `stop` would hang.
- [tested] After an uncaught error in a headless `-s` script, the trap still works. The script
  stopped at `nil foo` and the next line never printed. SIGTERM then saved and quit (rc 0)
  (`U2-error.log`). The saved image relaunched normally and saved again on SIGTERM
  (`U2-relaunch.log`).
- [tested] A script stuck on the author-initials prompt (a compile with no
  `setAuthorName:`) also left the trap working: SIGTERM gave rc 0 and the image was saved
  (`M-marker-noauthor.log`). The image saved in that state has the stuck script inside it.
- [tested] GUI arming time matches headless. SIGTERM at 0.1 s gave rc 143 in 3 of 3 runs. At
  0.2 s it gave rc 143 in 1 of 3. From 0.3 s to 2 s it saved in 8 of 8 (`G/`). Headless results
  are in `signal-trap-class.md`.
- [tested] Arming time with the bridge loaded and running at save (2026-11-11,
  `probes/q16/arming.txt`, `A/`; image 20,242,568 bytes against 19,791,248 for the pristine
  base). SIGTERM at 0.1 s and 0.2 s gave rc 143 in 3 of 3 runs each, both headless and GUI. From
  0.3 s to 0.5 s it saved in 3 of 3 each, both modes. That is slightly later than the plain
  armed image, which saved in 2 of 3 runs at 0.2 s.
- [tested] A `-s` start script runs after the start-up list, so the trap is already armed
  when the script starts: it printed `armed=true`. The script can read the VM's own pid
  through `primitiveGetPid` (`UnixOSProcessPlugin`) and write it to a file in the working
  directory. The file held `17680`, the same pid the shell saw (`M-marker.st`,
  `M-marker.log`). So a readiness file written by the start script means "trap armed".
- [tested] Identifying the process (`S-stale.txt`, `S-lsof.txt`):
  - `ps -p <pid> -o lstart=,command=` shows the start time to the second and the full
    command line. The command line holds the absolute image path when the launch passes one.
  - `lsof -a -p <pid> -d cwd` shows the working directory, which is the instance's `files/`
    folder in the planned layout.
  - The VM does not keep the `.image` file open, but it does keep the `.changes` file open.
    `lsof -t <instance>/Cuis7.8.changes` printed the VM's pid while it ran and nothing after
    it exited.
  - After exit, `ps -p` and `kill -0` both fail with rc 1.
- [inferred] A pid that has been reused shows a different command line or start time, so
  recording the pid together with its `lstart` at launch tells a reused pid from ours. Actual
  pid reuse was not reproduced.
- [inferred] Exit codes after `stop`'s signals (each code was seen in this session's runs, the
  mapping is inferred): 0 means saved by the trap, 143 means
  SIGTERM before the trap was armed or with no trap, and 137 means it took SIGKILL. `stop` can
  report which one happened only if it is the VM's parent; otherwise it sees the process gone,
  not the code. An image whose file is unchanged since `stop` began also shows that the save
  did not happen.

## Options

How `stop` can confirm the trap is armed before signalling:

- **Readiness file written by the start script** (tested above). Precise. It needs `start` to
  always pass a start script, which `start --bridge` does anyway.
- **Fixed minimum delay after start** (about 0.5 s would have covered every run). Simple, but
  it ignores slower hosts and larger images.
- **No check.** Signal anyway and report "not saved" when the image file is unchanged.

How `stop` can find the process:

- **Pid file plus a check** that `ps` shows the VM binary, the absolute image path and the
  recorded `lstart`.
- **`lsof -t` on the instance's `.changes` file.** Needs no pid file and finds VMs started
  outside `cuisctl` too. It is slower (one `lsof` call) and macOS/Unix only.

## Rejected / dead ends

- Identifying the VM by an open handle on the `.image` file. The VM does not keep it open.
- The first marker probe hung on the author prompt because the setup line was missing. The
  first pid probe ran under `| tee`, which put `wait` in a subshell (rc 127) and gave a false
  "still alive after exit". Both were rerun.

## Decisions

- Decision (user): the default `stop`, with no save, ends the VM with SIGKILL — because it
  works even when the image is busy, and with the trap armed a SIGTERM would save. The bridge
  cannot evaluate code, so there is no channel to disarm the trap first. Accepted caveat: no
  shutdown code runs. (Recommended by Claude, accepted by the user 2026-11-11.)

## Conclusion

`stop` must escalate. SIGTERM is enough only when the trap's handler can run: a busy Process at
user priority swallows the signal and keeps the VM alive until SIGKILL. A workable `stop`:

1. Find the process, either from a pid file whose pid `ps` confirms (VM binary, absolute image
   path, recorded start time) or by `lsof -t` on the instance's `.changes` file. If nothing is
   found, the instance is not running and any pid file is stale.
2. Send SIGTERM and poll until the process exits. Saves took under 0.35 s here, so a timeout of
   a few seconds is generous.
3. On timeout, send SIGKILL and report that the image was not saved.
4. Report the result: saved (image file changed), not saved (rc 143, or image file unchanged),
   or killed.

The trap is armed about 0.2–0.3 s after boot in both GUI and headless runs. A start script runs
after it is armed, so a readiness file written by the start script tells `stop` the trap is
live. A plain stop with no save (the default in the initiative) is just SIGKILL, or SIGTERM in
an image without the trap.

## Open questions

- ~~Should the default, no-save `stop` use SIGKILL or uninstall the trap and send SIGTERM?~~
  SIGKILL (see Decisions).
- ~~Does a busy Process below priority 30 starve the trap?~~ No: busy at 20 still saved; 30 and
  above starve a priority-30 handler (tested) in `trap-robustness.md`.
- ~~Real pid reuse~~ Out of scope: hard to force on macOS, and the recorded start time plus
  command line, or `lsof` on the `.changes` file, already identify the process.

## Sources

- `probes/q12/` (scripts, logs, `S-stale.txt`, `S-lsof.txt`)
- `probes/q16/arming.txt`, `A/`, `setup-trap.log`, `setup-bridge.log`
- `signal-trap-class.md`, `probes/q11/SignalTrap.pck.st`
