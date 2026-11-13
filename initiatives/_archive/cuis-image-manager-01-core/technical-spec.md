# cuis-image-manager (part 01: core) — technical spec

## Context

Part 01 builds the foundation of `cuisctl`: the CLI shell and output contract, `cuisctl`'s own
Cuis installation (the **Cuis home**), the per-instance layout, `create`, and `status`. Behavior
is defined in `functional-spec.md` (invariants 1–27). `start`/`stop` come in part 02 and
`reset`/`destroy`/the skill in part 03; part 01 defines the run-record format and the state
detection they rely on.

There is no `cuisctl` code yet. The closest prior art is the bridge's shared Cuis setup in
`mcp-bridge/server/src/cuisHome/`, which `cuisctl` must **not** import or touch (invariant 13,
and the user's decision that `cuisctl` is independent of the bridge). It is the model to follow:

- `cuisHome.ts:4-15` — layout `cuis/<key>/{dist,base}`, `<key>.lock`, `<key>.tmp-<pid>`,
  `<key>.error`; status precedence ready > preparing > failed > missing.
- `cuisHome.ts:197-221` — prepare in a temp dir, publish by `rename`, record failures, release
  the lock last. `:295-330` fetch with SHA-256 check; `:224-248` unzip and build `base`;
  `:251-268` headless smoke boot.
- `processLock.ts` — cross-process lock keyed by `{pid, startTime}` (`ps -o lstart=`), with
  stale-lock takeover. The same pid+lstart identity is what research recommends for run
  records (`research/stop-semantics.md`, Conclusion step 1).
- `pin.ts` — release, commit, archive URL and SHA-256, layout key `7.8-d4f9cc1`, file names,
  VM path `CuisVM.app/Contents/MacOS/Squeak`.
- `runner.ts:106-110` — VM invocation `<vm> -headless <image> -s <script>`, detached, output to
  a log file. `run.ts:106` shows the bridge runs the VM with cwd = `dist/` and writes
  `dist/UserChanges`; this is why the shared `dist/` cannot be made read-only.
- `testSupport/` — `fakeVm.ts` (shell-script VM honoring the same argv), `fakeDistribution.ts`
  (fake archive), `archiveServer.ts` (local HTTP server with failure modes), `tempHome.ts`.
- `mcp-bridge/server/package.json`, `tsconfig.json`, `vitest.config.ts` — Node ≥ 20, ESM,
  TypeScript strict, Vitest; the conventions `cuisctl` copies.

Research that shapes the layout (`initiatives/cuis-image-manager/research/launch-layout.md`):
Cuis takes its base directory from the image folder's parent when it has `Packages` or
`CoreUpdates` siblings, and its user directory from the process cwd. With `Packages` and
`CoreUpdates` next to `image/` and cwd = `files/`, shipped packages and the bridge's
requirements resolve and every user folder lands in `files/` (tested). Requirement search
walks every folder under the instances directory, which gives invariant 11 (tested).

**Research conflict, resolved by the user:** research chose a read-only shared `dist/`. The code
shows that breaks the bridge (cwd = `dist/`) and `rm -rf` of a home. The user chose a
per-instance copy-on-write `Packages` view instead, and the functional spec's invariant 10 was
amended accordingly. This mechanism is **untested** (research only symlinked the whole
`Packages` directory); phase 2 probes it before anything depends on it.

## Proposed changes

### Package

New sibling package `cuisctl/` at the repo root, independent of `mcp-bridge/server` (no import,
no `file:` dependency). Mirrors the server's toolchain: `package.json` (`type: module`,
`bin: { cuisctl: dist/cli.js }`, `engines.node >=20`, devDeps `typescript`, `vitest`,
`@types/node`; no runtime dependencies — argument parsing with `node:util` `parseArgs`),
`tsconfig.json` and `vitest.config.ts` copied from the server.

### Modules (`cuisctl/src/`)

- `pin.ts` — cuisctl's own pin: same release, commit, URL, SHA-256 and file names as the
  bridge's today, by choice, not by link. `CUIS_KEY` (`7.8-d4f9cc1`) is the version string
  recorded in each instance and reported by `status` (invariant 22).
- `paths.ts` — every path derives from one `home` (default `~/.cuisctl`, overridable through an
  options object; the CLI reads `CUISCTL_HOME` for tests only). Nothing uses `process.cwd()`
  (invariant 5).
  - `cuis/<key>/{dist,base}`, `cuis/<key>.lock`, `cuis/<key>.error`, `cuis/<key>.tmp-<pid>`
  - `instances/<name>/` — one instance (layout below)
  - `tmp/` — staging for `create`, outside `instances/` so Cuis's requirement walk never sees it
- `errors.ts` — `CuisctlError(kind, message, hint?)`. Kinds used in part 01: `usage`,
  `invalid_name`, `already_exists`, `not_found`, `unsupported_platform`, `cuis_fetch_failed`,
  `cuis_checksum_mismatch`, `cuis_write_failed`, `cuis_base_build_failed`, `cuis_corrupt`,
  `internal_error`. `hint` carries the resolving command (invariant 3).
- `lock.ts` — port of `processLock.ts` (pid + lstart, stale takeover). Reused in part 02 for
  per-instance locks (old invariant 52).
- `processInfo.ts` — `processStartTime(pid)`, `processCommand(pid)` via `ps -o lstart=,command=`
  (C locale), and `pidsHoldingFile(path)` via `lsof -t` (tested way to find a VM: it keeps the
  `.changes` file open, `stop-semantics.md`). Read-only: never signals.
- `launcher.ts` — minimal headless "run a script to completion" (port of `runner.ts` without
  the scratch copy: it runs a given image with a given cwd and timeout, kills the process
  group on timeout). Used by the home smoke boot and by integration tests; part 02 builds
  `start` on top of the same argv builder. Always appends `-ApplePersistenceIgnoreState YES`
  after the script arguments (`headless-pitfalls.md`). Never passes `-u` or package-loading
  options (invariant 12).
- `home.ts` — `homeStatus()` and `ensureHome(onProgress)`. Port of `cuisHome.ts` with one
  change: preparation runs in the foreground, since `create` must wait (invariant 14). If the
  lock is held by a live process, poll `homeStatus()` every 500 ms until it is ready or failed
  (invariant 16); a failed result raises that error kind (invariant 15). A ready home is checked
  for its required parts (VM, base image/changes/sources); missing parts raise `cuis_corrupt`
  with the hint "delete ~/.cuisctl/cuis/<key> and run the command again". Network is touched
  only inside `fetchArchive` (invariant 14). Progress goes to stderr through `onProgress`.
- `instance.ts` — name validation (`/^[a-z][a-z0-9-]*$/`, checked before any filesystem access,
  invariant 6), `createInstance`, `listInstances`, `readInstance`.
- `runRecord.ts` — the record part 02's `start` writes and `stop` removes:
  `instances/<name>/run.json` = `{pid, startTime, mode: 'gui'|'headless', bridge: boolean,
  saveOnStop: boolean, startedAt}`. `readRunRecord` only reads.
- `state.ts` — `instanceState(name)`, the single source of invariants 18–20:
  1. run record present, `ps` shows the pid with the recorded `startTime` and a command line
     containing the instance's image path → **running** with the record's fields;
  2. otherwise `pidsHoldingFile(image/Cuis7.8.changes)` non-empty → **running (untracked)**,
     with that pid;
  3. otherwise **stopped**. A record failing check 1 is stale and is ignored, never deleted here
     (invariant 21); part 02's mutating commands clear it.
- `commands/create.ts`, `commands/status.ts` — command logic returning a `Result`.
- `output.ts` — `Result = {ok: true, command, data} | {ok: false, error: {kind, message, hint?}}`;
  `renderText` and `renderJson`. Both are pure functions of the same `Result`, so outcome and
  exit code cannot diverge (invariant 2). Exit codes: 0 ok, 1 command error, 2 `usage`.
- `cli.ts` — `#!/usr/bin/env node` entry: parse argv (`--json` anywhere), platform gate for every
  command but `status` (invariant 26), dispatch, print exactly one document to stdout, exit.
  Never reads stdin (invariant 4). In part 01 the dispatch table has `create` and `status`;
  `start`, `stop`, `reset`, `destroy` are added by parts 02–03, so invariant 1 is complete only
  after part 03. Until then they are unknown commands (`usage` error).

### Instance layout

```
~/.cuisctl/instances/<name>/
  instance.json          {name, cuisKey, createdAt}      written before publish
  image/Cuis7.8.image    copy of base
  image/Cuis7.8.changes  copy of base (the VM appends to it)
  image/Cuis7.8.sources  symlink -> ~/.cuisctl/cuis/<key>/base/Cuis7.8.sources
  CoreUpdates            symlink -> ~/.cuisctl/cuis/<key>/dist/CoreUpdates
  Packages/              real directories mirroring dist/Packages, one symlink per file
  files/                 user files folder; the VM's cwd (part 02)
  vm.log                 VM output (created empty; written by part 02)
  run.json               run record (part 02)
```

- **Copy-on-write `Packages`** (invariant 10): Cuis saves a package by deleting the old file and
  writing a new one (`launch-layout.md`, read-only test: "Could not delete the old version of
  file"). In the instance's own writable `Packages/` directory the delete removes only the
  symlink and the write creates a real file there, so the shared file is untouched. Other
  instances still have their symlink to the shared file. The instance's `Packages` is searched
  first, so the instance keeps loading its own copy.
- `CoreUpdates` as a whole-directory symlink is enough: Cuis only reads it (`-u`), and the
  pinned 7.8 has no updates.
- Absolute symlinks into the home mean a deleted and re-prepared home (same path) makes them
  resolve again (invariant 17). Instance-owned files never point into the home except through
  these links.

### `create` flow

1. Validate name → `invalid_name` (no filesystem access).
2. `instances/<name>` exists → `already_exists`.
3. `ensureHome(progress)` (may download; invariants 14–16).
4. Build the instance in `tmp/<name>-<pid>-<uuid>/` (layout above, `files/` empty).
5. Publish with `fs.rename` to `instances/<name>`. Rename onto an existing directory fails
   (`ENOTEMPTY`/`EEXIST`) → `already_exists`, staging removed; this also settles two racing
   `create`s (invariant 24).
6. Any failure: remove staging. Leftover staging from a killed `create` is in `tmp/`, never seen
   as an instance, and removed by the next `create` when its pid is no longer alive
   (invariant 25).

### `status`

`status <name>`: `readInstance` (missing → `not_found`) plus `instanceState`, and paths and
`cuisKey` (invariant 22). `status`: every directory in `instances/` with a valid name and an
`instance.json`; empty or missing `instances/` → empty list, exit 0. No writes, no `mkdir`, no
lock, no signal (invariant 21). Status of the home itself is reported in the list view as a
header line (text) / `home` field (JSON).

### Tradeoffs

- **Own pin vs reuse.** A second copy of the same constants; accepted for independence. If the
  bridge later becomes a `cuisctl` client the duplication goes away (follow-up).
- **Foreground preparation.** `create` blocks for the download and base build (~30 MB plus a
  smoke boot). The bridge prepares in the background because an MCP call must return quickly;
  a CLI command is expected to wait.
- **Per-file symlinks vs copying `Packages`.** Copying is simpler and certain, but costs disk per
  instance and loses "other instances load the shared version" only for edited files anyway.
  Symlinks keep instances small; the probe decides.

## Implementation sequence

1. `cuisctl/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` entry for
   `cuisctl/dist/` if the server's `dist/` convention requires it
2. Probe (scratch, not committed): per-file symlink `Packages` view — save a shipped package in
   one instance, check the shared file is unchanged and the instance holds a real file; record
   the result in `initiatives/cuis-image-manager-01-core/logbook.md`
3. `cuisctl/src/pin.ts`, `cuisctl/src/paths.ts`, `cuisctl/src/errors.ts`
4. `cuisctl/src/output.ts` — `Result`, text and JSON rendering, exit codes
5. `cuisctl/src/lock.ts`, `cuisctl/src/processInfo.ts`
6. `cuisctl/src/testSupport/` — fake VM, fake archive, archive server, temp home (ported)
7. `cuisctl/src/launcher.ts` — headless run to completion with timeout
8. `cuisctl/src/home.ts` — status, foreground prepare, wait for another preparer, corruption check
9. `cuisctl/src/instance.ts` — name validation, layout builder, `createInstance`, listing
10. `cuisctl/src/runRecord.ts`, `cuisctl/src/state.ts` — record format and state detection
11. `cuisctl/src/commands/create.ts`, `cuisctl/src/commands/status.ts`
12. `cuisctl/src/cli.ts` — argv parsing, platform gate, dispatch, single-document output
13. `cuisctl/src/realCuis.integration.test.ts` — opt-in real download and real VM checks
14. `cuisctl/README.md` and a pointer in the root `README.md` repo layout

## Testing and validation

Unit and CLI tests run with Vitest against a temp home (`CUISCTL_HOME`) and the fake VM and
archive server, no network. CLI tests spawn `node dist/cli.js` as a child process with stdin
closed and no TTY. Integration tests (opt-in env var, macOS, real network and VM) mirror the
server's `realCuis.integration.test.ts`.

- **1** — part 01: `create` and `status` dispatch; other commands give `usage`. Full check after
  part 03.
- **2** — table test over every command outcome (success, no-op, each error kind): `--json`
  stdout parses as exactly one JSON document; text and JSON runs give the same exit code.
- **3** — each error kind has a non-empty message; kinds with a remedy carry `hint`; exit 0 only
  for `ok` results.
- **4** — every CLI test runs with stdin closed and no TTY and must finish; a test with stdin as
  an open pipe that is never written to also finishes (nothing reads it).
- **5** — run `create` and `status` from two different cwds; outputs equal and nothing is
  written in either cwd.
- **6** — names `Foo`, `1a`, `a_b`, `-a`, `a/b`, `..`, `` are refused with `invalid_name` and
  the temp home is byte-identical afterwards (snapshot of the tree).
- **7** — `create` writes only under `<home>/instances/<name>`; two instances are siblings.
- **8** — layout test asserts image, `files/`, `vm.log`. Integration: run a script with
  cwd = `files/` that compiles a method and prints Cuis's user folders; all are under `files/`
  and `files/UserChanges/` gains the change log.
- **9** — layout test asserts the symlinks; integration: script prints `coreUpdatesDirectory
  exists` and `packagesDirectory exists` true, and `CodePackageFile installPackage:` of
  `mcp-bridge/image/MCP-Bridge.pck.st` (read-only use of a repo file) leaves `McpBridgeServer`
  defined. The GUI no-dialog clause is checked through `start` in part 02.
- **10** — integration (the phase 2 probe made permanent): instance A loads JSON, adds a method,
  saves the package; shared file checksum unchanged, A's `Packages/Features/JSON.pck.st` is a
  regular file containing the method; instance B loads JSON without it.
- **11** — integration: A saves package `ProbeShared` to its `NewPackages`; B
  `Feature require:`s it and gets it.
- **12** — unit test on the launcher argv builder: never contains `-u` and no package-loading
  arguments; grep test that no source file sends `installPackage`/`Feature require`.
- **13** — test runs with `HOME` pointed at a temp dir containing a `.cuis-mcp-bridge/` and a
  `Cuis7-8-main/` canary tree: unchanged after all commands. Static check: no source file under
  `cuisctl/src` references `.cuis-mcp-bridge`, `Cuis7-8-main` or imports from `mcp-bridge`.
  Home `dist/` and `base/` checksums unchanged after `create` and after integration runs.
- **14** — `create` on a missing home and on a failed home prepares, prints progress on stderr,
  then succeeds; the archive server's request count is 1, and 0 for a second `create` on a
  ready home.
- **15** — archive server `not-found`, `reset-midstream`, wrong SHA, fake VM `bootFails`: each
  gives its error kind, `instances/` unchanged.
- **16** — test holds the home lock from a child process while `create` runs; `create` waits,
  the child publishes, `create` succeeds; request count stays at the child's 1.
- **17** — create instance, delete `cuis/<key>`, re-prepare; the instance's image and `files/`
  are unchanged and its symlinks resolve. (The "next `start`" path is part 02.)
- **18** — `state.ts` tests: no record and no holder → stopped; valid record (a long-running
  `sleep` child with the image path in its argv, recorded pid + lstart) → running with fields;
  a child holding the `.changes` file open and no record → running (untracked).
- **19** — record with a dead pid, and record whose pid is alive but with another `startTime` or
  command → stopped; `create` of another instance and `status` still succeed.
- **20** — record whose process exited → stopped (same mechanism as 19, from the VM's side).
- **21** — snapshot the home tree (names, mtimes, contents) and the process list before and after
  `status` in every state above, including stale records: identical.
- **22** — `status <name>` reports instance folder, `files/`, `vm.log` and `cuisKey`; `status`
  lists all; empty home → `[]` and exit 0.
- **23** — new instance's image bytes equal the base's; `files/` empty; state stopped; no VM
  process started (fake VM writes a marker if invoked).
- **24** — second `create` of the same name → `already_exists`, tree unchanged; two concurrent
  `create`s → one success, one `already_exists`.
- **25** — fault injection: fail after staging is half built, and kill a `create` child
  mid-copy; `status <name>` → `not_found`; next `create` succeeds and removes the dead staging.
- **26** — CLI run with the platform overridden to `linux`: every command but `status` gives
  `unsupported_platform` and neither the archive server nor the fake VM is touched; `status`
  works.
- **27** — `npm test --prefix mcp-bridge/server` passes unchanged; the bridge's `cuis/` home is
  never touched (covered by the canary in 13).

## Risks and mitigations

- **Copy-on-write may not hold.** If Cuis resolves the symlink and writes through it, or refuses
  to delete a symlink, the shared file changes. Phase 2 probes it first; if it fails, fall back
  to copying `Packages/` per instance (same invariant, more disk) and record it in the logbook.
- **Symlinks in Cuis's requirement walk.** The walk follows symlinks (`launch-layout.md`, H2b),
  so each instance's `Packages/` view is also reachable from other instances through the
  `instances/` walk. Packages are found earlier in the instance's own `Packages`, so the walk is
  reached only for unknown requirements; cost is linear (~3 ms per instance, tested).
- **Long `create` on first use.** The first `create` downloads ~30 MB and boots the VM once;
  progress on stderr makes the wait visible.
- **`lsof` speed.** One `lsof` per instance in `status`; acceptable for tens of instances.

## Follow-ups

- Resolve the open question on invariant 26 (whole tool macOS-only) before part 02.
- Consider making the bridge a `cuisctl` client so only one Cuis installation exists.
