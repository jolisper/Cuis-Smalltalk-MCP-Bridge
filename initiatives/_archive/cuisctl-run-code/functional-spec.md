# cuisctl-run-code — functional spec

## Summary

`cuisctl` gains a `run` command that executes Smalltalk code in a named Cuis instance and reports
a machine-readable outcome: status, output, result and the elapsed time of the code itself. The
consumer is a CLI user or automation (scripts, CI, other tools). By default a run is disposable.

Terms: a **run** is one execution of the caller's code in an instance. The **outcome** is what
the command reports for it. The **result** is the text form of the value of the code's last
expression.

## Behavior

### Invocation and input

1. `cuisctl run <name> <code>` runs the inline `<code>`; `cuisctl run <name> --file <path>` runs
   the contents of a file; `cuisctl run <name> --stdin` runs what is read from standard input.
   Exactly one of the three sources must be given.
2. Options: `--headless` / `--gui` (window or no window; default **headless**), `--save` (keep
   the run's changes), `--detach` (leave the VM running afterwards), `--timeout <seconds>`
   and `--json`. Any other option is a `usage` error, as for every `cuisctl` command.
   **Open question:** headless as the default differs from `start`, whose default is GUI. It is
   proposed because `run` is meant for scripts.
3. No source, more than one source, an empty code text, an unreadable or missing `--file` path
   and a `--save` together with `--detach` are `usage` errors (exit 2). Nothing is started
   and the instance is untouched.
4. Standard input is read only when `--stdin` is given. If it is empty or attached to a terminal
   the command fails with `usage` at once; it never prompts or waits for a person to type.
5. Inline code that begins with `-` is read as an option; the caller uses `--file` or `--stdin`
   for it.
6. The code is evaluated as a script. The value of its last expression is the result; code with
   no value yields the text form of `nil`.
7. `--timeout` takes a whole number of seconds with a documented default and maximum; zero,
   negative, non-numeric or too large values are `usage` errors, never clamped.
   **Open question:** default and maximum (proposed: default 60 s).
8. Code is evaluated in the instance's own image, so the classes, packages and state already
   saved in that instance are visible to it.

### Outcome

9. Every run that starts the code ends with exactly one status: `passed`, `failed` or
   `timed_out`. Problems that stop the run before any code executes are ordinary `cuisctl`
   errors (see "Setup failures"), never a run status.
10. `passed`: the code ran to completion without an unhandled error. Exit code 0, `ok:true`.
11. `failed`: the code raised an unhandled error (including a syntax or compile error), or the VM
    ended before the code completed (for example the code quit the VM). Exit code 1, `ok:false`,
    error kind `run_failed`. The error description is included.
12. `timed_out`: the code did not finish within the time limit. The VM is killed. Exit code 1,
    `ok:false`, error kind `run_timed_out`.
13. The outcome carries, for `passed`, `failed` and `timed_out` alike: the status, the
    **output**, the **result** (only when the code completed), the **elapsed time**, whether the
    image was **saved**, and for `failed` the error description. In `--json` mode these fields
    are present for failures as well as successes. In text mode the same information is printed
    as one human-readable document. Which JSON object holds them is left to the technical spec.
14. Output is what the code wrote to the Transcript during the run, in order, whether or not
    anything was enabled for it. Output produced before a failure or timeout is included.
15. Elapsed time is an integer number of milliseconds covering the execution of the caller's
    code only: not VM boot, not teardown, not preparation of the outcome. It is reported whenever
    the code began executing, including for `failed` and `timed_out`.
16. Output is capped at 64 KB: when longer, the first 16 KB and the last 48 KB are kept and the
    outcome says it was truncated and reports the full size in bytes. The result is capped at
    4 KB with the same indication. Status is derived from the full run, never from truncated
    text. Output floods cannot exhaust the memory of the `cuisctl` process.
17. An error inside the code never leaves the run hanging until the time limit, in headless or
    GUI mode: no debugger window or prompt blocks it. It ends promptly as `failed` with the
    error and the output so far.
18. The command never runs longer than the time limit plus a short grace period once the code has
    started, however the code hangs.

### Disposable by default

19. After a default run (no `--save`, no `--detach`) the instance's image and changes files
    are byte-for-byte what they were before, whatever the status and whatever the code did,
    including code that saves the image. The instance is `stopped`, no VM process remains and
    `run.json` is absent.
20. The code is not sandboxed. Files it writes (for example into the instance's `files/` folder)
    persist, and it can use the network, start processes or quit the VM. Disposable refers only
    to the image and changes files.
21. Consecutive default runs on the same instance start from the same image state: a class or
    global defined by one run is not visible to the next.

### Keeping changes

22. With `--save`, when the run is `passed` the instance's image is saved after the code
    completes, and the outcome reports `saved: true`. The next `start` or `run` sees the
    changes.
23. With `--save`, a `failed` or `timed_out` run is not saved: the image is unchanged and the
    outcome reports `saved: false`.
24. If `--save` is given, the code passed and the image could not be saved, the command fails
    with `not_saved` (exit 1). The outcome is still reported and the instance is `stopped`.

### Keeping the VM running

25. With `--detach`, when the run is `passed` or `failed` the VM is left running with the
    window mode chosen for the run and no bridge. `status` shows the instance as `running` with
    its pid and mode, and `stop` (with or without `--save`) works on it as on any started
    instance. The image is not saved by the run itself.
26. A `timed_out` run is always killed, even with `--detach`; the instance ends
    `stopped`.
27. A detached instance follows the existing `start` rules: `start <name>` with the same mode
    and no bridge is a no-op (`alreadyRunning`); with another mode or with `--bridge` it fails
    `instance_running`. A further `run` on it is refused (invariant 30).
28. If the code quits the VM, nothing is left running even with `--detach`, and the
    status is `failed`.

### Setup failures (no code executed)

29. `usage`, `invalid_name`, `not_found`, `unsupported_platform` (not macOS), `busy`,
    `version_mismatch`, `home_not_ready` and the Cuis-home preparation errors behave as for the
    existing commands. Like `start`, `run` prepares a missing Cuis home first; unlike `reset`, it
    does not fail with `home_not_ready` for that reason.
30. A running instance, tracked or untracked, is refused with `instance_running`
    (`hint: cuisctl stop <name>`); nothing is signalled and the code is not run in it.
31. If the instance does not become ready within the start time limit, the command fails with
    `start_failed`, including the last 20 lines of `vm.log`; the VM is killed, the image is
    unchanged and the instance is `stopped`. The code is not executed.
32. Input problems (invariants 3 and 4) are detected before the Cuis home is prepared or any VM
    is started.

### Concurrency and interruption

33. `run` takes the per-instance lock for the whole run; if another `cuisctl` command holds it,
    `run` fails at once with `busy`. A `run` on one instance does not block `status` or
    commands on other instances. With `--detach` the lock is released when the command
    returns.
34. If the `cuisctl` process is interrupted (Ctrl-C or SIGTERM) during a run, the VM it started is
    killed, the image is unchanged, the lock is released and no `run.json` remains. Exception: a
    `--detach` VM already handed over (command returned) is not affected.
35. If the VM dies unexpectedly before the code completes, the run ends promptly as `failed`; it
    does not wait for the time limit.

### Output channels and exit codes

36. stdout carries exactly one document; progress messages go to stderr. The code's output
    appears inside the document, not interleaved on stdout.
37. `--json` is accepted anywhere on the command line and switches stdout to one JSON document;
    the exit code is the same. Exit codes: 0 `passed`, 1 `failed`, `timed_out`, `not_saved` and
    other command errors, 2 `usage`.
38. Text errors are `error: <message>` plus a `hint:` line when there is one, as elsewhere.

### Must not regress

39. `create`, `status`, `start`, `stop`, `reset` and `destroy` behave exactly as before, including
    their ignoring of standard input and their rejection of `--stdin` as an unknown option.
40. Only `run --stdin` ever reads standard input. The README's statement that `cuisctl` never
    reads standard input is revised to say so, and the README documents `run`, its options, its
    outcome and its new error kinds.
41. `cuisctl` still never prompts and does not depend on the current directory, except that a
    relative `--file` path resolves against it.
