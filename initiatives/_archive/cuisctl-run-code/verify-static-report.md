# Static verify report — cuisctl-run-code
Date: 2026-11-16

Test files come from the logbook's implementation files (all under cuisctl/src/). Paths below are relative to that directory. Real-VM cases in realCuis.integration.test.ts are gated by CUISCTL_REAL_CUIS=1.

Invariant 1 — `cuisctl run <name> <code>` runs the inline code; --file; --stdin; exactly one source
  Static: covered — commands/runInput.test.ts:6 (inline), :46 (file), :65 (stdin), :123 (two sources rejected)

Invariant 2 — Options: --headless/--gui (default headless), --keep, --keep-running, --timeout, --json; other options are usage errors
  Static: covered — runCli.test.ts:270 (unknown/run-only flags exit 2); commands/run.test.ts:644 (headless default, --gui)

Invariant 3 — No source, several sources, empty code, bad --file, --keep with --keep-running are usage errors; nothing started
  Static: covered — runCli.test.ts:299; commands/runInput.test.ts:24, :101, :123, :147, :216

Invariant 4 — Standard input read only with --stdin; empty or terminal fails with usage at once
  Static: covered — commands/runInput.test.ts:81; cli.test.ts:183 (closed/empty/blank stdin exit 2, no waiting)

Invariant 5 — Inline code beginning with `-` is read as an option
  Static: covered — runCli.test.ts:537

Invariant 6 — Code evaluated as a script; last expression is the result; no value yields nil
  Static: covered — startScript.test.ts:378; realCuis.integration.test.ts:642, :652

Invariant 7 — --timeout whole seconds, default and maximum documented; invalid values are usage errors
  Static: covered — commands/runInput.test.ts:170 (5, 300), :191 (0, -1, abc, 1.5, 301, empty, ' 5'); :6 (default 60)

Invariant 8 — Code evaluated in the instance's own image
  Static: covered — realCuis.integration.test.ts:714 (--keep class visible to the next run; gated)

Invariant 9 — Every started run ends with exactly one status; setup problems are ordinary errors, not a status
  Static: covered — commands/run.test.ts:22 (passed), :96 (failed), :138 (timed_out), :318 (start_failed carries no run status)

Invariant 10 — passed: exit 0, ok:true
  Static: covered — commands/run.test.ts:22; runCli.test.ts:511

Invariant 11 — failed: unhandled error or VM ended early; exit 1, ok:false, run_failed, description included
  Static: covered — commands/run.test.ts:96, :183; runCli.test.ts:736; realCuis.integration.test.ts:659, :694, :781

Invariant 12 — timed_out: VM killed, exit 1, ok:false, run_timed_out
  Static: covered — commands/run.test.ts:138; runCli.test.ts:569

Invariant 13 — Outcome carries status, output, result, elapsed, saved, error; present in --json for failures too; text document
  Static: covered — output.test.ts:399, :422, :493, :521, :551; runCli.test.ts:703, :736

Invariant 14 — Output is the Transcript output in order, including output before failure or timeout
  Static: covered — runOutcome.test.ts:78, :109, :208; commands/run.test.ts:138; realCuis.integration.test.ts:659

Invariant 15 — Elapsed time in integer ms covering only the caller's code, reported for failed and timed_out too
  Static: covered — startScript.test.ts:346; commands/run.test.ts:138 (elapsed on timed_out); realCuis.integration.test.ts:733

Invariant 16 — Output capped at 64 KB (16 KB head + 48 KB tail), result at 4 KB, truncation reported, bounded memory
  Static: covered — runOutcome.test.ts:53, :123, :157; startScript.test.ts:435; commands/run.test.ts:228; output.test.ts:445, :470

Invariant 17 — An error in the code never hangs the run; ends promptly as failed with output so far
  Static: covered — startScript.test.ts:186, :246; realCuis.integration.test.ts:694, :704 (no debugger hang); commands/run.test.ts:96

Invariant 18 — Never runs longer than the time limit plus a short grace once started
  Static: covered — commands/run.test.ts:138; runCli.test.ts:569; realCuis.integration.test.ts:741

Invariant 19 — Default run leaves image and changes byte-for-byte; instance stopped, no VM, run.json absent
  Static: covered — commands/run.test.ts:61, :22, :96 (restored after failure); imageBackup.test.ts:39, :62

Invariant 20 — Code is not sandboxed; files it writes (e.g. into files/) persist
  Static: no coverage found — no test has run code that writes a file or uses network/processes; the fake VM does not execute code and the real-VM cases never write to files/

Invariant 21 — Consecutive default runs start from the same image state
  Static: covered — realCuis.integration.test.ts:714 (global from a default run absent in the next; gated); commands/run.test.ts:61

Invariant 22 — --keep on passed saves the image, saved:true
  Static: covered — commands/run.test.ts:365; runCli.test.ts:673

Invariant 23 — --keep on failed or timed_out does not save, saved:false
  Static: covered — commands/run.test.ts:411

Invariant 24 — --keep, passed, save impossible: not_saved (exit 1), outcome reported, instance stopped
  Static: covered — commands/run.test.ts:473

Invariant 25 — --keep-running leaves the VM running with chosen mode and no bridge; status and stop work
  Static: covered — commands/run.test.ts:519, :644; runCli.test.ts:643

Invariant 26 — timed_out is always killed even with --keep-running
  Static: covered — commands/run.test.ts:582

Invariant 27 — Kept-alive instance follows start rules; further run refused
  Static: covered — commands/run.test.ts:686

Invariant 28 — Code that quits the VM leaves nothing running even with --keep-running; failed
  Static: covered — commands/run.test.ts:582; realCuis.integration.test.ts:781

Invariant 29 — usage, invalid_name, not_found, unsupported_platform, busy, version_mismatch, home_not_ready behave as elsewhere; missing home is prepared
  Static: covered — commands/run.test.ts:971, :1013, :749; runCli.test.ts:945

Invariant 30 — Running instance (tracked or untracked) refused with instance_running and hint
  Static: covered — commands/run.test.ts:259

Invariant 31 — Instance not ready in the start time: start_failed with vm.log tail, VM killed, image unchanged
  Static: covered — commands/run.test.ts:318

Invariant 32 — Input problems detected before home prep or any VM start
  Static: covered — runCli.test.ts:299

Invariant 33 — run takes the per-instance lock; busy at once; status unaffected; lock released with --keep-running
  Static: covered — commands/run.test.ts:749, :519

Invariant 34 — Interrupt (Ctrl-C/SIGTERM) kills VM, restores image, releases lock, no run.json; handed-over VM unaffected
  Static: covered — cli.test.ts:346 (SIGINT/SIGTERM via built CLI); commands/run.test.ts:813, :889; runCli.test.ts:595

Invariant 35 — VM dying before the code completes ends promptly as failed
  Static: covered — commands/run.test.ts:183

Invariant 36 — stdout carries exactly one document; progress goes to stderr
  Static: covered — runCli.test.ts:144, :511, :736

Invariant 37 — --json accepted anywhere; one JSON document; same exit code; exit codes 0/1/2
  Static: covered — runCli.test.ts:144, :703, :736; output.test.ts:6, :17, :31

Invariant 38 — Text errors are `error: <message>` plus `hint:` line
  Static: covered — output.test.ts:60, :74

Invariant 39 — create/status/start/stop/reset/destroy unchanged, ignore stdin, reject --stdin
  Static: covered — runCli.test.ts:270; cli.test.ts:229, :268

Invariant 40 — Only run --stdin reads standard input; README revised and documents run
  Static: covered — cli.test.ts:183, :229, :268 (stdin half); the README text (cuisctl/README.md:349) is not checked by any test

Invariant 41 — Never prompts; independent of cwd except relative --file
  Static: covered — cli.test.ts:115; runCli.test.ts:703 (--file)

41 invariants — 40 covered, 1 uncovered
