# cuisctl-run-code

## Problem

`cuisctl` manages named Cuis images: it can create, start, stop, reset and destroy them, but it cannot make an instance do anything. Running Smalltalk code in an instance today means opening the image and doing it by hand, which rules out scripting, repeatable experiments, and any use from automation or other tools.

Without a way to run code and read back a structured outcome, a named instance is only a place to click around in. People who want to try a snippet, check that something still works, or time a piece of code have no command-line path to do so.

## Goals

- Let a user run Smalltalk code in a named instance from the command line, with the code supplied inline, from a file, or from standard input.
- Report a machine-readable outcome for each run: whether it succeeded, what it produced, what it returned, and how long the code itself took, so the outcome can be used for performance testing as well as pass/fail checks.
- Make the default run disposable: the instance's image is left as it was unless the user explicitly asks to keep the run's changes.
- Offer the user control over how the run happens: with or without a window, leaving the VM running afterwards for further use with the existing instance commands, and a time limit that stops runaway code.
- Fit the existing `cuisctl` behavior: one result document per invocation, a JSON mode, per-instance exclusion, the established exit codes, and structured error kinds.

## Non-goals

- Bringing code or packages into an instance (loading, dependency resolution).
- Reaching an instance from outside the run: no bridge, no evaluation inside a live VM, no interactive or long-lived sessions. A run against an instance that is already running is refused, not served.
- Protecting the host from the code being run.
- Changing how the existing `cuisctl` commands behave, beyond the documentation changes this initiative requires.

## Scope

Mostly a new `cuisctl` command that builds on what `start` and `stop` already do: booting an instance and judging it ready, recording a detached VM so `status` and `stop` can see it, taking the per-instance lock, and reporting structured errors. The new parts are on the Smalltalk side of the run (wrapping the user's code so its outcome, output and timing can be captured) and on the input side (a standard-input source, which `cuisctl` has deliberately never had).

Documentation is affected: the README's statement that `cuisctl` never reads standard input needs to change, and the new command needs documenting alongside the others. The change is moderate in size, with the outcome format and standard-input handling the main design decisions.

## Open questions

- **Outcome statuses and fields.** The exact set of statuses a run can end in (for example passed, failed, timed out, setup error), the fields of the outcome, the truncation caps for output and result, and the unit used for elapsed time. To be resolved in the spec phase.
- **Standard input and the README.** How the "never reads stdin" statement is revised, and how `--stdin` behaves when standard input is empty or attached to a terminal. To be resolved in the spec phase.
