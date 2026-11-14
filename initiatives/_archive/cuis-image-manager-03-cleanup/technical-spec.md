# cuis-image-manager (part 03: cleanup) — technical spec

## Context

Part 03 adds `reset` and `destroy` to `cuisctl` and the thin Claude skill that wraps the tool.
Behavior is in `functional-spec.md` (invariants 1–11). Parts 01 and 02 are built and archived
(`initiatives/_archive/cuis-image-manager-0{1,2}-*/`); this part extends their modules and must
not break part 01 invariants 4, 5, 13, 21, 27 and part 02 invariants 10, 18, 22.

Where part 03 plugs in:

- `cuisctl/src/runCli.ts:65-100` — `COMMANDS` table (`start`, `stop`, `create`, `status`); each
  entry declares `accepts` (its flags), `platformFree`, `nameOptional`, `run`. `:46-50` `Flags`
  and `:102-107` `OPTIONS` hold the booleans. `:187-189` the usage hint lists the table keys, so
  adding entries is what makes part 01 invariant 1 hold. `CliContext` (`:37-44`) carries
  per-command test seams.
- `cuisctl/src/instance.ts` — `createInstance` (`:44-64`) builds in `tmp/` and publishes with
  one `rename`; `stagingEntryName` (`:72-74`) and `removeDeadStaging` (`:79-94`) clean entries
  `<name>-<pid>-<uuid>` left by dead processes; `buildImage` (`:145-151`) copies base image and
  changes and links the base sources; `readInstance` (`:157-167`) gives `not_found`.
- `cuisctl/src/commands/start.ts:86-94` — `requireCurrentCuisVersion` (`version_mismatch`, part
  02 invariant 20, which also binds `reset`). `:100-121` the `instance_running` error and its
  `cuisctl stop <name>` hint.
- `cuisctl/src/commands/stop.ts:154-170` — the command shape to copy: `validateName`,
  `readInstance`, `withInstanceLock`, `instanceState`, `errorResult`.
- `cuisctl/src/state.ts:37-49` — `instanceState`: `running`, `running_untracked` (a process holds
  `image/Cuis7.8.changes`, via `lsof -t`), `stopped`. Read-only. `processInfo.ts:48-57`
  `pidsHoldingFile` returns `[]` when `lsof` exits 1 with no output, which is also what a missing
  `.changes` file gives (invariant 3's missing-image case).
- `cuisctl/src/commands/instanceLock.ts` — `withInstanceLock` → `busy` at once (part 02 inv 18).
  Locks live in `<home>/locks/`, outside `instances/`, so `destroy` never deletes a held lock
  (decided in part 02, `paths.ts:117-130`).
- `cuisctl/src/home.ts:78-106` — `ensureHome` prepares a missing home (network); `:111-127`
  `checkReadyHome` (`cuis_corrupt` when a base file is gone); `:326-340` `homeStatus`.
- `cuisctl/src/output.ts:45-61` — `renderText` switch; unrendered commands print `''`.
- `cuisctl/src/errors.ts:8-25` — `ErrorKind` union.
- `cuisctl/src/staticChecks.test.ts` — bans bridge paths, `installPackage` outside
  `startScript.ts`, and `process.kill` outside `processControl.ts`/`launcher.ts`.
- `.claude/skills/run-cuisctl/SKILL.md` — the verification driver for `/spec-verify-dynamic`,
  not the consumer skill of invariants 10–11. No consumer skill exists yet.
- `cuisctl/README.md:295-297` — "Not in this part yet: reset, destroy and the Claude skill".

Research (`initiatives/cuis-image-manager/research/`): `trap-robustness.md` Decision names
`reset` as the recovery for an image saved with a runaway forked Process (invariant 3's "unable
to start" case); `launch-layout.md` Decision keeps the shared `dist/` pristine "for a meaningful
reset". Neither prescribes a mechanism; nothing conflicts with the code.

## Proposed changes

### Shared pieces

- `errors.ts` — add `confirmation_required` (`destroy` without `--yes`) and `home_not_ready`
  (`reset` with no usable base).
- `home.ts` — export `requireReadyHome(home)`: `homeStatus` is `ready` → `checkReadyHome`;
  otherwise throw `home_not_ready` naming the state. It never prepares (see Tradeoffs).
- `instance.ts`:
  - Move `requireCurrentCuisVersion` here from `start.ts` (export; `start.ts` imports it).
  - `resetImage(home, name)` — see `reset` step 5.
  - `removeInstance(home, name)` — see `destroy` step 5. Reuses `stagingEntryName`, so a
    leftover from an interrupted destroy is swept by the next `create`'s `removeDeadStaging`.

### `reset <name>` — `commands/reset.ts` (new)

1. `validateName`, `readInstance` → `not_found`; `requireCurrentCuisVersion` → `version_mismatch`.
2. `withInstanceLock` (part 02 inv 18).
3. `instanceState`: anything but `stopped` → `instance_running` "Instance "<name>" is running;
   stop it first", hint `cuisctl stop <name>` (inv 2). Read-only, nothing signalled (part 02
   inv 10).
4. `requireReadyHome` (base image, changes and sources present).
5. `resetImage`: `mkdir image/ -p` (inv 3, missing folder); delete any `*.cuisctl-reset-*` in
   `image/` (the lock guarantees they are leftovers of an interrupted reset); `copyFile` base
   image → `Cuis7.8.image.cuisctl-reset-<pid>`, base changes → `….changes.cuisctl-reset-<pid>`;
   `rename` the image temp over the image, then the changes temp over the changes; re-create the
   sources symlink if it is missing or points elsewhere. Any throw before the renames deletes
   the temps. Each `rename` is atomic within `image/`, so the image file is always a complete
   old or complete fresh one (inv 4). Only `image/` is touched: `files/`, `Packages/`,
   `CoreUpdates`, `vm.log`, `run.json` are left as they are (inv 1, 4).
6. Ok `{command: 'reset', data: InstanceView}` (stopped view, via `stoppedView`).

Invariant 3 holds because nothing in the flow reads the old image: state comes from the run
record and `lsof` on the changes file, and a missing image or changes file is replaced.

### `destroy <name> [--yes]` — `commands/destroy.ts` (new)

1. `validateName`, `readInstance` → `not_found` (inv 8). No version check: a mismatched
   instance must stay removable.
2. `instanceState` (read-only, no lock): not `stopped` → `instance_running` with the stop hint
   (inv 7). Checked before `--yes` so a running instance is never answered "pass --yes".
3. Without `--yes` → `confirmation_required`: "destroy would delete <instance folder>, including
   its user files in <files folder>", hint `cuisctl destroy <name> --yes` (inv 6). No lock, no
   write: this path is as read-only as `status`.
4. With `--yes`: `withInstanceLock`, re-run step 2 under the lock (a `start` may have won the
   race).
5. `removeInstance`: `mkdir tmp/ -p`; `rename instances/<name>` → `tmp/<name>-<pid>-<uuid>`;
   `rm -r --force` that entry. After the rename the name is free (inv 5) and `status` no longer
   lists it; a crash during `rm` leaves only a swept staging entry. `fs.rm` unlinks symlinks
   without following them, so the shared `dist/`/`base/` behind `CoreUpdates`, `Packages/*`
   and `image/Cuis7.8.sources`, and anything a user symlinked from `files/`, are untouched
   (inv 9, part 01 inv 13/27).
6. Ok `{command: 'destroy', data: {name, removed: {instance, files}}}`. The lock file is
   released (deleted) as for every locked command; it is cuisctl's own, outside `instances/`.

### CLI and output

- `runCli.ts` — `Flags`/`OPTIONS` gain `yes`. Entries `reset: {accepts: []}` and
  `destroy: {accepts: ['yes']}`, both behind the macOS gate. No new `CliContext` seam: the
  interruption seam (Testing, inv 4) is exercised on `runReset` directly. The usage hint picks
  up both keys.
- `output.ts` — `reset`: "`<name>: reset to the pristine base (Cuis <key>); user files kept`"
  plus `pathLines`. `destroy`: "`<name>: destroyed (removed <instance folder>, including its
  user files)`". Errors render as today.

### The skill — `.claude/skills/cuisctl/SKILL.md` (new)

A consumer skill, separate from the `run-cuisctl` verification driver. Content:

- Invocation: `cuisctl` when on `PATH`, else `node <repo>/cuisctl/dist/cli.js`; always `--json`;
  report the result's message or the error's message and hint verbatim. Exit code is the
  outcome.
- One section per command (`create`, `status`, `start [--headless] [--bridge]`,
  `stop [--save]`, `reset`, `destroy`) mapping the user's request to exactly that command line.
  Explicit "do not" list (inv 10): never chain commands the user did not ask for (no automatic
  `stop` before `reset`/`destroy`, no `create` after `not_found`, no retry), never touch
  `~/.cuisctl` files directly, never pick flags the user did not ask for.
- `destroy` protocol (inv 11): run `cuisctl destroy <name> --json` without `--yes`; show the
  user what it says would be deleted; ask; pass `--yes` only after an explicit yes in the
  conversation to that question for that name. Earlier or blanket approvals do not count; any
  other answer ends there.

### Tradeoffs

- **`reset` does not prepare a missing Cuis home.** Part 01 inv 14 says only `create`/`start`
  use the network. With the home missing, `reset` fails `home_not_ready`, hint `cuisctl start
  <name>` (which prepares it; if the image cannot start, `start` fails and `reset` then works).
  Alternative: call `ensureHome` like `start`, simpler for the user but contradicts inv 14.
  Confirm during implementation.
- **Two renames, not one.** Image and changes are swapped by two atomic renames, image first.
  Interrupted between them, the instance has the fresh image with the old changes file; the
  fresh image's source pointers lie in the base prefix, which an append-only old changes file
  still holds. Re-running `reset` completes it. A single-rename directory swap would leave a
  window with no `image/` at all, which inv 4 forbids.
- **`Packages/` copy-on-write overrides survive `reset`.** A shipped package the user saved
  stays the instance's own copy. Reset is defined on the image only; inv 1 forbids touching
  user files, and `Packages/` is neither, so the plan leaves it. Alternative: re-mirror
  `Packages/` from `dist/`.
- **Skill location.** `.claude/skills/cuisctl/` makes it discoverable in this repo; when the
  tool moves to its own repository the skill moves with it (Follow-ups).

## Implementation sequence

1. `cuisctl/src/errors.ts` — `confirmation_required`, `home_not_ready`
2. `cuisctl/src/home.ts` — `requireReadyHome`
3. `cuisctl/src/instance.ts` and `cuisctl/src/commands/start.ts` — move `requireCurrentCuisVersion`, add `resetImage`, `removeInstance`
4. `cuisctl/src/commands/reset.ts` — reset flow
5. `cuisctl/src/commands/destroy.ts` — destroy flow
6. `cuisctl/src/output.ts` — `reset`/`destroy` text rendering
7. `cuisctl/src/runCli.ts` — `--yes`, `reset` and `destroy` entries
8. `cuisctl/src/realCuis.integration.test.ts` — real reset recovery and destroy
9. `cuisctl/README.md` and `.claude/skills/run-cuisctl/SKILL.md` — document and drive `reset`/`destroy`
10. `.claude/skills/cuisctl/SKILL.md` — consumer skill

## Testing and validation

Command tests use `testSupport/lifecycleHome.ts` (fake distribution, long-running fake VM) and
the untracked-holder pattern from `stop.test.ts:233-260` (a child holding the `.changes` file).
`snapshotTree(dir)` (names, types, symlink targets, sizes, SHA-256) is added to `testSupport/`
for the before/after comparisons below.

- **Invariant 1** — after `start`, write files under `files/` (nested folder, a symlink), `stop`,
  append bytes to the image and changes; `reset` → image and changes byte-equal to `base/`,
  `snapshotTree(files/)` unchanged, sources symlink points at the base. Real: an instance with a
  compiled method (saved via `stop --save`) is reset; the method is gone after `start`, and
  `files/UserChanges/` still holds it.
- **Invariant 2** — running (fake VM via `start`) and untracked holder → `instance_running` with
  hint `cuisctl stop demo`; image bytes unchanged; VM/holder still alive (part 02 inv 10).
- **Invariant 3** — `reset` succeeds with: image deleted; changes deleted; `image/` deleted;
  image truncated to 10 bytes; sources symlink deleted. Each then `start --headless` (fake)
  reaches running. Real: the `trap-robustness.md` busy-loop image (saved with a forked loop at
  priority 40) gives `start_failed`; `reset`; `start --headless` reaches running.
- **Invariant 4** — `resetImage` takes an injectable `copy` (default `copyFile`), used only by
  tests: a copy that writes half the bytes and throws → `runReset` errors, image and changes
  byte-equal to before, no `*.cuisctl-reset-*` left, `files/` unchanged. Leftover temp from a
  dead pid in `image/` → removed by the next successful `reset`. Static: `resetImage` writes
  only to `*.cuisctl-reset-*` paths before its renames (code review).
- **Invariant 5** — `destroy demo --yes` → ok; `instances/demo` gone; `status demo` →
  `not_found`; `status` list omits it; `create demo` succeeds.
- **Invariant 6** — `destroy demo` → `confirmation_required`, exit 1, message contains the
  instance and files paths, hint `cuisctl destroy demo --yes`; `snapshotTree(home)` unchanged
  (no `locks/` or `tmp/` created). Same in `--json`.
- **Invariant 7** — running and untracked → `instance_running` with and without `--yes`;
  instance tree unchanged; holder alive. Lock race: hold `locks/demo.lock`, `destroy --yes` →
  `busy`.
- **Invariant 8** — `destroy nope` and `destroy nope --yes` → `not_found`; `destroy Bad_Name` →
  `invalid_name`.
- **Invariant 9** — home with a second instance, a canary file in `<home>`, and `files/link`
  symlinked to a folder outside the home holding a file: `snapshotTree` of `cuis/`, the other
  instance, the canary and the outside folder are unchanged after `destroy --yes`; `tmp/` has
  no leftover entry. A `tmp/demo-<deadpid>-<uuid>` entry is removed by the next `create`.
- **Invariant 10** — manual review against the skill's command list, plus `/spec-verify-dynamic`
  scenarios driving the skill: each command requested in plain words maps to one `cuisctl`
  call with the user's flags; `reset` on a running instance reports the tool's error and does
  not stop it; `start` of a missing instance reports `not_found` and does not create.
- **Invariant 11** — `/spec-verify-dynamic` scenarios: "destroy demo" → the skill runs
  `destroy demo` without `--yes`, shows the paths and asks; answering "no" leaves the instance;
  "yes" → `--yes` call, instance gone. A prompt like "destroy demo, I confirm" before the list
  is shown still gets the question. `grep -- '--yes' SKILL.md` hits only the destroy protocol.
- **Part 01 inv 1** — usage-hint test lists `reset` and `destroy`; `reset demo --save`,
  `destroy demo --headless` → `usage`.
- **Part 01 inv 4, 5** — `runCli.test.ts` process-level tests extended to `reset` and
  `destroy` (stdin closed and a TTY-less run give the same output; same result from two cwds).
- **Part 01 inv 13, 27** — `staticChecks.test.ts` unchanged and passing; invariant 9's test
  checksums `cuis/<key>/` after both commands.
- **Part 01 inv 21** — the status snapshot test gains a `confirmation_required` destroy run
  next to it: neither changes the home.
- **Part 02 inv 10** — invariant 2/7 tests assert the holder is alive and received no signal;
  the `process.kill` static check stays.
- **Part 02 inv 18** — held instance lock: `reset` and `destroy --yes` → `busy` in under 1 s;
  `status` unaffected.
- **Part 02 inv 22** — no code change in `start`/`stop`; their suites run unchanged.
- **Part 02 inv 20 (reset clause)** — `cuisKey: "7.7-0000000"` → `reset` gives
  `version_mismatch`, image unchanged; `destroy --yes` still removes it.

## Risks and mitigations

- **A VM started outside cuisctl between the state check and the renames.** The running VM keeps
  the old inode and later saves over the fresh image. Window is milliseconds; the instance lock
  covers every cuisctl path, and the next `status` shows it running.
- **`start` racing `destroy`.** `start` reads `instance.json` before taking the lock; if a
  `destroy --yes` completes in between, `start` fails writing `start.st` with an
  `internal_error`. Nothing is recreated (it writes into a missing folder). Acceptable; a
  re-read under the lock in `start` would make it `not_found`.
- **Condensed changes file.** The two-rename interruption case relies on the old changes file
  extending the base one; a user who condensed changes and whose reset is interrupted between
  the renames gets wrong source text until `reset` is re-run.

## Follow-ups

- Move `.claude/skills/cuisctl/` with the tool when it gets its own repository.
- Map a corrupt `instance.json`/`run.json` to a typed error (part 01 open item); `destroy`
  could then remove an instance whose record is unreadable.
- Remove README's "Not in this part yet" section (done in phase 9).
