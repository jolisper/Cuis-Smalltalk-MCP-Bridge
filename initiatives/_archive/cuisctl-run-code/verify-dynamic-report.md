# Dynamic verify report — cuisctl-run-code
Date: 2026-11-16

Run against freshly built `cuisctl/dist/cli.js`, throwaway `CUISCTL_HOME`, headless only, no bridge. Dependencies: all local (throwaway home, local Cuis VM, pinned Cuis zip already downloaded). Feature flags: none needed.

Invariant 1 — `cuisctl run <name> <code>` / `--file` / `--stdin`, exactly one source
  Dynamic: pass
Invariant 2 — Options `--headless`/`--gui`, `--keep`, `--keep-running`, `--timeout`, `--json`; other options are `usage`
  Dynamic: pass (headless default exercised; `--gui` only checked for mutual exclusion, never launched; unknown option exit 2)
Invariant 3 — No source, several sources, empty code, bad `--file`, `--keep` with `--keep-running` are `usage` (exit 2)
  Dynamic: pass
Invariant 4 — Standard input read only with `--stdin`; empty/terminal is `usage` at once
  Dynamic: pass (`--stdin </dev/null` gives usage, exit 2)
Invariant 5 — Code starting with `-` needs `--`/`--file`/`--stdin`
  Dynamic: pass
Invariant 6 — Script evaluation; last expression is the result; no value gives `nil`
  Dynamic: pass
Invariant 7 — `--timeout` whole seconds; zero/negative/non-numeric/too large are `usage`
  Dynamic: pass (0, abc, 301 and -1 give exit 2; default 60 s observed)
Invariant 8 — Code evaluated in the instance's own image
  Dynamic: pass (class kept by `--keep` visible to later runs)
Invariant 9 — Exactly one status; setup problems are ordinary errors
  Dynamic: pass
Invariant 10 — `passed`: exit 0, `ok:true`
  Dynamic: pass
Invariant 11 — `failed` on unhandled/syntax error or VM ending: exit 1, `run_failed`, error description
  Dynamic: pass (ZeroDivide, doesNotUnderstand, syntax error, VM quit)
Invariant 12 — `timed_out`: VM killed, exit 1, `run_timed_out`
  Dynamic: pass
Invariant 13 — Outcome carries status, output, result, elapsed, saved, error, also in `--json` for failures
  Dynamic: pass
Invariant 14 — Output is Transcript output in order, including before failure
  Dynamic: pass ("one","two" in order; "before" kept on 1/0)
Invariant 15 — Elapsed ms for the code only, reported also for failed and timed_out
  Dynamic: pass (e.g. timed_out reported 2039 ms for a 2 s limit)
Invariant 16 — Output cap 64 KB head 16 KB + tail 48 KB with size; result cap 4 KB; no memory exhaustion
  Dynamic: pass (24 MB flood: truncated, output 18666 chars, outputBytes 24288938; result cut at 4096)
Invariant 17 — Errors never hang; end promptly as `failed` (no debugger blocking)
  Dynamic: pass (class definition `Object subclass: #ZzProbe ...` ended passed in 40 ms, result ZzProbe; `Object compile: 'zzProbe ^1' classified: 'zz'` passed in 2 ms, result #zzProbe; 1/0, `nil foo` and `3 +` each failed in 0-3 ms with output kept)
Invariant 18 — Never longer than the time limit plus grace
  Dynamic: pass (`[true] whileTrue` with --timeout 2 ended in about 2 s; saveAs: hang ended at the 60 s limit)
Invariant 19 — Default run leaves image and changes files byte-for-byte unchanged, instance stopped, no VM, no `run.json`, even when code saves the image
  Dynamic: pass (original `Cuis7.8.image/.changes/.sources` checksums identical after `saveAs:`, `saveAndQuit`, failures and timeouts; stopped, no `run.json`). Observation: code calling `Smalltalk saveAs: 'zzsaved'` (or `'Cuis7.8'`) wrote extra files (`zzsaved.*`, `Cuis7.*`) into `image/`, the run then timed out at 60 s instead of completing, and `reset` did not remove those extra files
Invariant 20 — Not sandboxed; files written to `files/` persist
  Dynamic: pass
Invariant 21 — Consecutive default runs start from the same image state
  Dynamic: pass (class defined in a default run was not visible to the next, both before and after a `--keep` run; the `--keep` class stayed visible)
Invariant 22 — `--keep` on `passed` saves the image, `saved: true`, next run sees changes
  Dynamic: pass (class definition under `--keep` gave `saved: true`; later runs saw ZzKeep and its compiled method)
Invariant 23 — `--keep` on `failed`/`timed_out` is not saved
  Dynamic: pass (class definition followed by 1/0 under `--keep`: `saved: false`, class absent afterwards)
Invariant 24 — `--keep`, passed, save fails gives `not_saved` (exit 1), outcome reported, stopped
  Dynamic: skip — no runtime surface to exercise (a save failure could not be induced on a healthy instance)
Invariant 25 — `--keep-running` on passed/failed leaves VM running (mode, no bridge); `status` and `stop` work; image not saved by the run
  Dynamic: pass (passed and failed both left a headless, bridge-off VM; `stop` and `stop --save` worked)
Invariant 26 — `timed_out` is always killed, even with `--keep-running`
  Dynamic: pass
Invariant 27 — Kept-alive instance follows `start` rules
  Dynamic: pass (same mode `already running`; other mode and `--bridge` gave `instance_running`)
Invariant 28 — Code quits the VM: nothing left running, `failed`
  Dynamic: pass
Invariant 29 — Setup errors as for existing commands; `run` prepares a missing home
  Dynamic: pass (`not_found`, `invalid_name`; first run on a fresh home via `create`)
Invariant 30 — Running instance refused with `instance_running` and hint
  Dynamic: pass (tracked instance only; untracked not exercised)
Invariant 31 — Not ready in time gives `start_failed` with last 20 log lines
  Dynamic: skip — no runtime surface to exercise (a boot failure could not be induced without modifying the instance)
Invariant 32 — Input problems detected before the home is prepared or any VM starts
  Dynamic: pass (bad `--file` and empty `--stdin` on a missing home: usage, home directory not created)
Invariant 33 — Per-instance lock for the whole run; `busy`; other commands unblocked
  Dynamic: pass (second run failed at once with `busy` while the first completed; `status` and `create other` worked meanwhile)
Invariant 34 — Interruption (SIGINT/SIGTERM) kills the VM, image unchanged, lock released, no `run.json`
  Dynamic: pass (both signals: exit 1, `interrupted`, stopped, no VM, no `run.json`)
Invariant 35 — VM dying early ends promptly as `failed`
  Dynamic: pass (VM quit ended in 53 ms)
Invariant 36 — stdout one document; progress to stderr; code output inside the document
  Dynamic: pass
Invariant 37 — `--json` accepted anywhere; exit codes 0/1/2
  Dynamic: pass
Invariant 38 — Text errors `error:` plus `hint:`
  Dynamic: pass
Invariant 39 — Other commands unchanged; reject `--stdin` as unknown option
  Dynamic: pass (status, start, stop, create reject `--stdin`; status, reset, destroy work as before)
Invariant 40 — Only `run --stdin` reads stdin; README revised and documents `run`
  Dynamic: pass (README documents `run`, `--stdin`, `run_failed`, `run_timed_out`, `not_saved`)
Invariant 41 — No prompts; cwd independent except relative `--file`
  Dynamic: pass (relative `--file` resolved against cwd; no prompts seen)

41 invariants — 39 passed, 0 failed, 2 skipped
