---
spec: /Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/initiatives/cuis-image-manager-03-cleanup/technical-spec.md
started: 2026-11-12
last-completed-phase: 11
status: archived
archived: 2026-11-13
---

# Implementation Log: cuis-image-manager-03-cleanup

Part 03 adds reset and destroy to cuisctl, plus the consumer Claude skill that wraps the tool. Eleven phases: error kinds, requireReadyHome, moving requireCurrentCuisVersion plus a snapshotTree test helper, resetImage/removeInstance, the reset and destroy commands, output rendering, CLI wiring, real-Cuis integration tests, docs, and the consumer skill. Starting at phase 1. Done means functional invariants 1-11 have passing tests (or a documented review for the skill), the regression invariants from parts 01 and 02 still hold, and the full vitest suite is green. Decision: reset on a missing home fails home_not_ready and does not prepare the home (keeps part 01 inv 14).

## Phase Plan

1. [Scaffold] errors.ts — confirmation_required, home_not_ready
2. [TDD] home.ts — requireReadyHome
3. [Scaffold] move requireCurrentCuisVersion start.ts → instance.ts; testSupport/snapshotTree.ts
4. [TDD] instance.ts — resetImage, removeInstance
5. [TDD] commands/reset.ts — runReset
6. [TDD] commands/destroy.ts — runDestroy
7. [TDD] output.ts — reset/destroy rendering
8. [TDD] runCli.ts — --yes, reset/destroy entries
9. [Scaffold] realCuis.integration.test.ts — real reset recovery and destroy
10. [Scaffold] cuisctl/README.md, .claude/skills/run-cuisctl/SKILL.md
11. [Scaffold] .claude/skills/cuisctl/SKILL.md — consumer skill

## Phase 1 — [Scaffold] errors.ts — confirmation_required, home_not_ready

Added confirmation_required and home_not_ready to ErrorKind in cuisctl/src/errors.ts. npx tsc --noEmit clean.

### Phase 2 cycles

- cycle 2.1 [covered=1]: requireReadyHome(home, 'demo') on a fresh (missing) home rejects with CuisctlError kind home_not_ready, message containing 'missing', hint 'cuisctl start demo', and creates nothing under cuis/ — red: missing home → home_not_ready test / green: requireReadyHome stub always throws home_not_ready / refactor: nothing
- cycle 2.2 [covered=2]: requireReadyHome(home, 'demo') on a ready home with VM and base image/changes/sources present resolves without error — red: ready home resolves / green: return when homeStatus ready / refactor: nothing
- cycle 2.3 [covered=3]: requireReadyHome(home, 'demo') on a ready home whose base Cuis7.8.changes file was deleted rejects with cuis_corrupt naming that path — red: ready home missing base changes → cuis_corrupt / green: ready branch delegates to checkReadyHome / refactor: nothing
- cycle 2.4 [covered=4]: requireReadyHome(home, 'demo') on a failed home (error file recorded, no key dir) rejects with home_not_ready whose message contains 'failed' and hint 'cuisctl start demo' — red: failed home → home_not_ready naming 'failed' / green: message 'Cuis home is not ready (<state>)' / refactor: JSDoc states full contract

## Phase 2 — [TDD] home.ts — requireReadyHome

4 cycles. Tested: missing home → home_not_ready (hint 'cuisctl start <name>', nothing created); ready home resolves; ready home missing base changes → cuis_corrupt; failed home → home_not_ready naming the state. Message 'Cuis home is not ready (<state>)' is generic, so preparing is covered by the same branch with no separate test. Files: cuisctl/src/home.ts, cuisctl/src/home.test.ts. Deviation: signature requireReadyHome(home, name), not (home), so the hint can name the instance.

## Phase 3 — [Scaffold] move requireCurrentCuisVersion; testSupport/snapshotTree.ts

requireCurrentCuisVersion exported from instance.ts (behaviour unchanged); start.ts imports it. New testSupport/snapshotTree.ts (lstat walk, symlink targets, size+sha256, sorted) with 2 tests in testSupport.test.ts. tsc clean; start/instance/testSupport/staticChecks suites green (47 tests).

### Phase 4 cycles

- cycle 4.1 [covered=1]: resetImage(home, 'demo') on a created instance whose image and changes had bytes appended makes both byte-equal to the base image and changes — red: modified image/changes restored to base bytes / green: resetImage copies base files directly / refactor: module header mentions reset image
- cycle 4.2 [covered=2]: resetImage(home, 'demo') on an instance whose image/ folder was deleted recreates image/ with image and changes byte-equal to the base — red: deleted image/ recreated / green: mkdir image/ -p / refactor: nothing
- cycle 4.3 [covered=3]: resetImage(home, 'demo') on an instance whose image/Cuis7.8.sources symlink was deleted, and on one where it points elsewhere, leaves it a symlink whose target is the base sources file — red: sources symlink deleted/elsewhere → re-pointed at base / green: readlink check + rm + symlink / refactor: extracted ensureSymlink helper
- cycle 4.4 [covered=5]: resetImage(home, 'demo', copy) with a copy that writes half the source bytes to its destination and throws rejects with that error, leaves image and changes byte-equal to before, leaves no *.cuisctl-reset-* entry in image/, and leaves snapshotTree(files/) unchanged — red: failing mid-copy leaves old image/changes, no temps, files/ unchanged / green: injectable copy to .cuisctl-reset-<pid> temps, rm on throw, two renames / refactor: RESET_TEMP_MARKER + resetTempPath, JSDoc states invariant
- cycle 4.5 [covered=6]: resetImage(home, 'demo') with a leftover image/Cuis7.8.image.cuisctl-reset-999999 temp (dead pid) removes it and leaves no *.cuisctl-reset-* entry — red: leftover .cuisctl-reset-999999 temps removed / green: sweep image/ entries containing RESET_TEMP_MARKER after mkdir / refactor: extracted removeLeftoverResetTemps, JSDoc updated
- cycle 4.6 [covered=7]: removeInstance(home, 'demo') removes instances/demo, leaves no entry in tmp/, and leaves snapshotTree of cuis/ and of an outside folder symlinked from files/link unchanged — red: removeInstance removes folder, no tmp leftover, cuis/ and outside symlinked folder unchanged / green: mkdir tmp, rename into staging entry, rm -r force / refactor: header documents reset/remove protocols, removeInstance placed after reset block

## Phase 4 — [TDD] instance.ts — resetImage, removeInstance

6 cycles. resetImage: base bytes restored; missing image/ recreated; sources symlink re-pointed (missing / elsewhere); mid-copy failure leaves old image+changes, no temps, files/ unchanged (inv 4); leftover .cuisctl-reset-* removed. removeInstance: folder gone, tmp/ empty, cuis/ and outside symlink target unchanged (inv 5, 9). Files: cuisctl/src/instance.ts, cuisctl/src/instance.test.ts. Helpers: RESET_TEMP_MARKER, resetTempPath, removeLeftoverResetTemps, ensureSymlink, readlinkOrUndefined. The sweep of a leftover tmp/demo-<deadpid>-<uuid> by the next create is deferred to phase 6 (it reuses stagingEntryName, so no new code).

### Phase 5 cycles

- cycle 5.1 [covered=1]: runReset({home, name:'demo'}) on a stopped instance with modified image/changes and user files returns ok {command:'reset', data: stoppedView}, image/changes byte-equal to base, snapshotTree(files/) unchanged — red: reset on stopped demo restores base, files/ unchanged / green: reset.ts readInstance→resetImage→stoppedView / refactor: nothing
- cycle 5.2 [covered=2]: runReset on demo when running tracked (runStart headless with fake VM) and when running untracked (child holding the .changes file) returns error instance_running with hint 'cuisctl stop demo'; image bytes unchanged; the VM/holder process is still alive — red: tracked/untracked running → instance_running, image unchanged, VM alive / green: instanceState guard / refactor: extracted requireStopped helper
- cycle 5.3 [covered=3]: runReset on demo whose instance.json has cuisKey '7.7-0000000' returns error version_mismatch and leaves the image bytes unchanged — red: cuisKey 7.7-0000000 → version_mismatch, image unchanged / green: requireCurrentCuisVersion after readInstance / refactor: nothing
- cycle 5.4 [covered=4]: runReset on demo while locks/demo.lock is held by a live process returns error busy in under 1 s and leaves the image bytes unchanged — red: held instance lock → busy <1s, image unchanged / green: withInstanceLock around state check + reset / refactor: nothing
- cycle 5.5 [covered=5]: runReset on stopped demo after the home's cuis/<key> directory was removed returns error home_not_ready with hint 'cuisctl start demo', image bytes unchanged, and nothing is downloaded or created under cuis/ — red: missing Cuis key dir → home_not_ready hint 'cuisctl start demo', nothing prepared / green: requireReadyHome inside lock / refactor: header Flow step 1 wording
- cycle 5.6 [covered=6]: characterization (expected green; the code from earlier cycles already covers it): runReset recovers demo when image deleted / changes deleted / image/ deleted / image truncated to 10 bytes / sources symlink deleted, and runStart headless then reaches running (inv 3); runReset with a failing copy seam returns an error with image+changes unchanged, no .cuisctl-reset- temps, files/ unchanged (inv 4); runReset 'nope' → not_found — characterization: inv 3 it.each over 5 damage cases (reset ok, base restored, start headless reaches running): all pass with no implementation change, so no green or refactor step was needed
- cycle 5.7 [covered=7]: characterization (expected green): runReset with a copy seam that writes half the bytes and throws 'disk full' returns an error with image+changes unchanged, no .cuisctl-reset- temps, files/ unchanged (inv 4) — characterization: runReset with a failing copy seam leaves old image/changes, no temps, files/ unchanged (inv 4); passes with no implementation change
- cycle 5.8 [covered=8]: characterization (expected green): runReset({home, name:'nope'}) returns error not_found, and runReset({home, name:'Bad_Name'}) returns error invalid_name — characterization: nope → not_found, Bad_Name → invalid_name; passes

## Phase 5 — [TDD] commands/reset.ts — runReset

8 cycles (5 TDD, 3 characterization). Tested: stopped reset restores base, files/ unchanged (inv 1); tracked and untracked running → instance_running with hint 'cuisctl stop demo', image unchanged, VM alive (inv 2, part 02 inv 10); version_mismatch (part 02 inv 20); held lock → busy <1s (part 02 inv 18); missing home → home_not_ready, nothing prepared; recovery from 5 damage cases, then start reaches running (inv 3); failing copy seam (inv 4); not_found and invalid_name. Files: cuisctl/src/commands/reset.ts, cuisctl/src/commands/reset.test.ts. Flow: readInstance → requireCurrentCuisVersion → withInstanceLock(requireStopped → requireReadyHome → resetImage → stoppedView).

### Phase 6 cycles

- cycle 6.1 [covered=1]: runDestroy({home, name:'demo', yes:true}) on stopped demo returns ok {command:'destroy', data:{name:'demo', removed:{instance:<dir>, files:<files dir>}}}; instances/demo gone; runStatus demo → not_found; status list omits demo; runCreate demo succeeds — red: destroy --yes removes demo, status not_found/omitted, recreate ok / green: destroy.ts readInstance→removeInstance→DestroyView / refactor: satisfies DestroyView, import order
- cycle 6.2 [covered=2]: runDestroy({home, name:'demo'}) without yes returns error confirmation_required whose message contains the instance folder and files folder paths, hint 'cuisctl destroy demo --yes', and snapshotTree(home) is unchanged (no locks/ or tmp/ created) — red: no --yes → confirmation_required naming folders, hint --yes, home tree unchanged / green: guard before removeInstance / refactor: nothing
- cycle 6.3 [covered=3]: runDestroy on demo running tracked or untracked, with and without yes, returns error instance_running hint 'cuisctl stop demo'; snapshotTree(instance dir) unchanged; VM/holder still alive — red: running tracked/untracked × yes → instance_running, instance intact, VM alive / green: state check before yes / refactor: shared requireStopped exported from state.ts, used by reset and destroy
- cycle 6.4 [covered=4]: runDestroy({home, name:'demo', yes:true}) while locks/demo.lock is held by a live process returns error busy in under 1 s and instances/demo still exists — red: held lock + --yes → busy <1s, instance remains / green: withInstanceLock(requireStopped → removeInstance) / refactor: header notes no version check on purpose
- cycle 6.5 [covered=5]: characterization (expected green): inv 9 — characterization: inv 9 (cuis/, other instance, canary, outside symlink target unchanged; tmp empty; dead staging swept by create) passes
- cycle 6.6 [covered=6]: characterization (expected green): inv 8 — characterization: nope (±yes) → not_found, Bad_Name → invalid_name, version-mismatched demo --yes removed; passes

## Phase 6 — [TDD] commands/destroy.ts — runDestroy

6 cycles (4 TDD, 2 characterization). Tested: --yes removes demo, status not_found/omits it, name reusable (inv 5); no --yes → confirmation_required naming both folders, hint --yes, home tree unchanged (inv 6, 01 inv 21); running tracked/untracked ± yes → instance_running before confirmation, VM alive (inv 7, 02 inv 10); held lock → busy <1s (inv 7 race, 02 inv 18); inv 9 (cuis/, other instance, canary, symlink target unchanged; tmp empty; dead staging swept by create); not_found/invalid_name (inv 8); version-mismatched instance still removable (02 inv 20). Files: cuisctl/src/commands/destroy.ts, destroy.test.ts, plus requireStopped moved to state.ts (shared with reset). Flow: readInstance → requireStopped → confirmation_required unless yes → withInstanceLock(requireStopped → removeInstance → DestroyView).

### Phase 7 cycles

- cycle 7.1 [covered=1]: renderText of ok result {command:'reset', data: InstanceView stopped for 'demo' cuisKey '7.8-abc'} returns '<name>: reset to the pristine base (Cuis <key>); user files kept\n' followed by the folder/files/log path lines — red: reset result rendered as pristine-base line + paths / green: renderReset + case 'reset' / refactor: JSDoc reflow
- cycle 7.2 [covered=2]: renderText of ok result {command:'destroy', data:{name:'demo', removed:{instance:'/h/instances/demo', files:'/h/instances/demo/files'}}} returns 'demo: destroyed (removed /h/instances/demo, including its user files)\n' — red: destroy result rendered as destroyed line / green: renderDestroy + case 'destroy' / refactor: helpers after renderStop, JSDoc matches output

## Phase 7 — [TDD] output.ts — reset/destroy rendering

2 cycles. renderText renders reset ('<name>: reset to the pristine base (Cuis <key>); user files kept' + path lines) and destroy ('<name>: destroyed (removed <instance folder>, including its user files)'). Files: cuisctl/src/output.ts, output.test.ts. Errors render as before.

### Phase 8 cycles

- cycle 8.1 [covered=1]: runCli(['reset','demo','--json'], ctx) with CUISCTL_HOME at a lifecycle home (platform darwin) returns exitCode 0 and stdout JSON {ok:true, command:'reset', ...}, and the text form 'reset demo' prints the pristine-base line — red: runCli reset demo text/json / green: reset entry in COMMANDS (accepts [], macOS gated) / refactor: nothing; stale unknown-command test list updated (reset removed)
- cycle 8.2 [covered=2]: runCli(['destroy','demo','--yes','--json'], ctx) on a stopped demo returns exitCode 0 and JSON {ok:true, command:'destroy'}; runCli(['destroy','demo','--json']) without --yes returns exitCode 1 and JSON error kind 'confirmation_required' with demo intact — red: runCli destroy demo needs --yes (confirmation_required exit 1, then ok exit 0) / green: yes flag + destroy entry / refactor: header comment wrap; stale unknown-command list now frobnicate only
- cycle 8.3 [covered=3]: characterization (expected green): usage hint lists reset and destroy; reset demo --save, reset demo --yes, destroy demo --headless → usage error exit 2 with 'unknown option: --<flag>'; reset and destroy on a non-darwin platform → unsupported_platform — characterization: reset/destroy reject foreign flags with usage exit 2, hint lists both, non-darwin → unsupported_platform; passes
- cycle 8.4 [covered=4]: characterization (expected green): part 01 inv 4 and 5 — characterization: process-level cli.test.ts — reset/destroy (± --json, no --yes, not_found) identical stdout/exit across stdin closed/open and two cwds; passes

## Phase 8 — [TDD] runCli.ts — --yes, reset/destroy entries

4 cycles (2 TDD, 2 characterization). reset: {accepts: []} and destroy: {accepts: ['yes']} registered behind the macOS gate; --yes flag parsed. Tested: text/json dispatch of reset, destroy requiring --yes (exit 1 confirmation_required, then exit 0), foreign flags → usage exit 2, usage hint lists both, non-darwin → unsupported_platform, process-level determinism (cli.test.ts). Stale unknown-command test list reduced to frobnicate (reset/destroy now registered). Files: cuisctl/src/runCli.ts, runCli.test.ts, cli.test.ts.

## Phase 9 — [Scaffold] realCuis.integration.test.ts — real reset recovery and destroy

3 real-Cuis tests added in the lifecycle describe: reset 1 (method saved, reset, gone after start; files/UserChanges kept), reset 3 (busy-loop image at priority 40 → start_failed; reset; start reaches running), destroy (instance gone, cuis/<key> unchanged, status not_found). Verified with CUISCTL_REAL_CUIS=1 (4 passed incl. prepares, 36s); default run skips the file; tsc clean. Deviation: image saved via the SIGTERM-trap bootOnce path used by existing tests rather than runStop --save; method-gone check via a run() script after start/stop. No GUI tests.

## Phase 10 — [Scaffold] README and run-cuisctl docs

cuisctl/README.md: reset and destroy sections, --yes, new error kinds (confirmation_required, home_not_ready), lock notes, test section, 'Not in this part yet' removed. .claude/skills/run-cuisctl/SKILL.md: Reset and destroy run section, gotchas. Docs written from code and technical spec (not run). README links to the consumer skill added in phase 11.

## Phase 11 — [Scaffold] consumer skill

.claude/skills/cuisctl/SKILL.md: invocation (cuisctl or node dist/cli.js, always --json, verbatim message/hint, exit codes), one section per command, do-not list (inv 10), destroy protocol (inv 11). The --yes flag appears once, in the destroy protocol (grep checked). Invariants 10-11 remain to be exercised by /spec-verify-dynamic.

Built cuisctl reset and destroy plus the consumer skill. reset replaces image and changes with temp copies of the base renamed into place (image always complete old or fresh), re-points the sources link, keeps files/, refuses running instances, works on missing or damaged images, and never prepares a missing home (home_not_ready). destroy needs --yes (confirmation_required otherwise), refuses running instances, renames the instance into tmp/ then removes it without following symlinks. Deviations: requireReadyHome takes (home, name) for the hint; requireStopped is shared from state.ts by reset and destroy; the real-Cuis tests save images through the SIGTERM-trap path used by existing tests rather than stop --save; several cycles were characterization tests over behavior already driven in lower layers (no green step). Stale unknown-command test lists were trimmed as reset/destroy became known commands. Full vitest suite green (253 passed, real-Cuis suite skipped by default; the 3 new real tests passed with CUISCTL_REAL_CUIS=1). Skill invariants 10-11 await /spec-verify-dynamic.

## Implementation files

- cuisctl/src/errors.ts
- cuisctl/src/home.ts
- cuisctl/src/home.test.ts
- cuisctl/src/instance.ts
- cuisctl/src/instance.test.ts
- cuisctl/src/state.ts
- cuisctl/src/commands/start.ts
- cuisctl/src/commands/reset.ts
- cuisctl/src/commands/reset.test.ts
- cuisctl/src/commands/destroy.ts
- cuisctl/src/commands/destroy.test.ts
- cuisctl/src/output.ts
- cuisctl/src/output.test.ts
- cuisctl/src/runCli.ts
- cuisctl/src/runCli.test.ts
- cuisctl/src/cli.test.ts
- cuisctl/src/testSupport/snapshotTree.ts
- cuisctl/src/testSupport/testSupport.test.ts
- cuisctl/src/realCuis.integration.test.ts
- cuisctl/README.md
- .claude/skills/run-cuisctl/SKILL.md
- .claude/skills/cuisctl/SKILL.md

## Retrospective

All 11 phases completed: 5 scaffolding and 6 TDD, 30 cycles, about 8 of them characterization tests over behavior already driven in lower layers. The full suite is green (253 passed), and the 3 new real-Cuis tests pass with CUISCTL_REAL_CUIS=1. Static verification covered invariants 1-9 with tests; dynamic verification passed all 11 against real headless VMs, including 24 killed resets that never left a half-written image.

Deviations from the spec: requireReadyHome takes (home, name) so its hint can name the instance; requireStopped moved to state.ts and is shared by reset and destroy; the real-Cuis tests save images via the SIGTERM-trap path existing tests use rather than stop --save; and the stale unknown-command test lists were trimmed as reset and destroy became registered commands.

Observations: the flagged tradeoff held, with reset never preparing a missing home (home_not_ready). The first dynamic "unchanged" snapshot checks for destroy were invalid (a shell argument limit) and were redone with a real snapshot, so a check that cannot fail should be proven able to fail first. Invariant 10 was verified by the model following the skill, not an independent harness, and invariant 11's "no" answer and pre-confirmation cases were not exercised. The Risks section's start-racing-destroy window (start fails with internal_error) remains accepted but unfixed.
