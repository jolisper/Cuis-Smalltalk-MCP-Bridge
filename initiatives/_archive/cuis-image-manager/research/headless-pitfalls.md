---
started: 2026-11-10
updated: 2026-11-11
---

## Question

Is `-ApplePersistenceIgnoreState YES` reliable, and does a bare undeclared class name in a `-s`
script really hang? (Agenda question 5.) Widened to cover what makes a headless `-s` run hang,
since `cuisctl` will generate start scripts (see `bridge-loading.md`).

## Context

Earlier sessions blamed hangs on several causes and did not isolate them: the macOS
crash-restore alert, a missing author name, undeclared names, and a mid-file temp declaration
(`prior-findings.md` "Headless pitfalls", `signal-trap-persistence.md`). Research ran
2026-11-10 on macOS 25.6, Cuis 7.8, VM `7.20260327.1636`. Each probe is a 3–5 line `-s` script on
a fresh copy of the pristine base image, with marker lines `M1`/`M2` around the statement under
test, a final `Smalltalk quitPrimitive: 0.`, and a 15 s watchdog (`kill -9`, rc 137). Scripts
and logs are in `probes/q14/`. The image copies were deleted after the runs.

## Findings

| Probe | Statement under test | Result |
|---|---|---|
| P1 | bare undeclared name `FooUndeclared.`, no author | exits, M1 M2 |
| P1b | `FooUndeclared printString.`, no author | exits, M1 M2 |
| P2 | `Object subclass: #ProbeX ...`, no author | **hangs** after M1 |
| P2b | `Object compile: 'probeY ^ 1'`, no author | **hangs** after M1 |
| P3 | `\| x \|` after other statements (author set) | **hangs**, no markers at all |
| P3b | `\| x \|` as the first line | exits, M1 M2 |
| P3c | `\| x \| x := 3.` after other statements | **hangs**, no markers |
| P6 | syntax error `3 + .` | **hangs**, no markers |
| P4 | uncaught error `nil foo` | **hangs** after M1 |
| P4b | `[ nil foo ] on: Error do: [...]` | exits, M1 M1caught M2 |
| P5 | plain script, no `-ApplePersistenceIgnoreState` | exits, 3 of 3 |
| P7 | handler that runs `Smalltalk quitPrimitive: 1` | exits with rc 1 |

- [tested] A bare undeclared name does not hang, with or without an author name (P1, P1b). The
  log (`P1-undeclared-noauthor.log`) shows `FooUndeclared is Undeclared` and the script
  continues. This settles the
  agenda question: the earlier claim was wrong, and its hangs came from other causes.
- [tested] Any compile that is logged to the changes file (class definition, `compile:`) hangs
  when no author name is set (P2, P2b). Setting `Utilities setAuthorName:initials:` first avoids
  it (every other probe in this research).
- [tested] A syntax error anywhere in the file hangs the run before any statement executes
  (P6). A temp declaration that is not on the first line is a syntax error of this kind (P3,
  P3c, versus P3b). [inferred] The `-s` file is compiled as one unit, where temps are allowed
  only at the start, and the syntax-error handler waits for input that never comes. This
  explains the Q1 "mid-file `| cls |`" hang and the stray `;` in a pragma.
- [tested] An uncaught error hangs the script while the VM keeps running (P4). Statements after
  it never run. A handler around the statement avoids it (P4b). A handler that calls
  `Smalltalk quitPrimitive: 1` ends the VM with exit code 1 (P7). The SIGTERM trap still works in
  this state (`stop-semantics.md`, `U2-error.log`).
- [tested] Without `-ApplePersistenceIgnoreState YES` the VM booted normally in 3 of 3 runs
  (P5), after a day of many `kill -9` exits. The newest Squeak crash report in
  `~/Library/Logs/DiagnosticReports` was from 2026-11-04. [inferred] The macOS restore alert
  is triggered by a recent crash report, not by `kill -9` exits. The alert was not reproduced
  here. With the flag after the script arguments, every headless and GUI launch in this
  session (`probes/q11`–`q15`) booted. Before `-headless` it fails with `unknown option`
  (`prior-findings.md`).
- [documented] Output appears only with `Transcript logToStdout: true.`
  (`signal-trap-persistence.md` Findings: "Headless `-s` scripts print nothing unless the script
  starts with `Transcript logToStdout: true.`"). In every hang above
  the log shows nothing about the cause.

## Options

How `cuisctl` can keep generated start scripts from hanging:

- **Fixed script template.** Start with any temps on the first line (or use none), then
  `Transcript logToStdout: true.` and `Utilities setAuthorName:initials:`. Wrap the work in
  `[ ... ] on: Error do: [ :e | log it. Smalltalk quitPrimitive: 1 ]`. Write the readiness
  file last. Syntax errors cannot be caught this way, so the template has to be tested.
- **Watchdog.** `start` waits for the readiness file with a timeout. If the file does not
  appear, it reports failure, shows the log, and kills the VM. This also covers syntax errors
  and author prompts.

## Rejected / dead ends

- A bare undeclared name as the cause of a hang (P1, P1b).

## Conclusion

Four things hang a headless `-s` run, all silently:
- a compile with no author name set;
- any syntax error in the file, including a temp declaration that is not on the first line,
  which stops the run before any statement executes;
- an uncaught error, after which the rest of the script never runs;
- the macOS restore alert after a recent crash.

A bare undeclared name does not hang. `-ApplePersistenceIgnoreState YES` placed after the script
arguments was reliable in every launch. It is harmless when no alert is pending, so `cuisctl`
should always pass it. Generated start scripts should set the author first, wrap their work in an
error handler that quits with a non-zero code, and end with the readiness file. `start` should
treat a missing readiness file after a timeout as failure.

## Open questions

- ~~What the VM is waiting on in each hang~~ Out of scope: it does not change the
  mitigation (author first, error handler, readiness file with a timeout).
- ~~Reproducing the restore alert~~ Out of scope: it needs a real VM crash, and the flag is
  passed on every launch anyway.

## Sources

- `probes/q14/` (scripts, logs)
- `prior-findings.md` ("Headless pitfalls"), `signal-trap-persistence.md`, `stop-semantics.md`
