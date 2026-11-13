# Cuis MCP Bridge

Two related efforts living in one repo, both centered on [Cuis Smalltalk](https://cuis.st/):

- **`mcp-bridge/`** — an MCP server that exposes read-only reflection into a running Cuis
  image (categories, classes, protocols, methods, source, comments) as tools Claude Code can
  call, so an AI assistant can browse a live image the way a developer would through the
  System Browser. It also has host-side tools, no image needed, that mirror the OpenSmalltalk
  VM source locally (`setup_vm_mirror`) and return a primitive's C source from the exact commit
  the running VM was built from (`get_vm_source`), and one that runs Smalltalk code or SUnit
  tests in a transient headless Cuis (`run_smalltalk`, macOS only; never touches the live image).
- **`vm-exploration/`** — a hands-on sandbox for exploring the boundary between the
  OpenSmalltalk VM and the Smalltalk image: writing external VM primitives from scratch (in C
  and in Zig) and wiring them up to a running image.

## Repo layout

```
mcp-bridge/          The bridge itself — see mcp-bridge/README.md for setup and usage.
  image/             Cuis-side package (MCP-Bridge.pck.st) — a TCP server loaded into the image.
  server/            Node.js/TypeScript process — speaks MCP over stdio, NDJSON over TCP.
  PROTOCOL.md         The wire protocol between the two halves.

vm-exploration/      VM/image primitive exploration sandbox.
  plugins/           Our own plugin sources: DummyPlugin (C), DummyPluginZig (Zig).
  image/             The Cuis-side package and headless test script exercising both plugins.
  build.zig          Builds both plugin bundles directly — no VM build required (see docs/).
  docs/              HowToBuild.md and PluginManual.md — how to build the VM and write a plugin.
  references/        Background papers on Smalltalk VM development.

cuisctl/             Manager for named Cuis images (instances) — see cuisctl/README.md.

initiatives/         Per-initiative planning docs (problem/goals, specs, logbooks) — not code.
tools/               Setup, build, and test scripts shared across the repo (see below).
TODO.md              Open follow-ups not yet turned into an initiative.
```

`Cuis7-8-main/` (the Cuis distribution) and `opensmalltalk-vm/` (the OpenSmalltalk VM source)
are **not versioned** — see `.gitignore`. Both are fetched on demand; see Setup below.

## Setup

```
tools/setup.sh
```

Fetches both external dependencies this repo needs but doesn't version: the Cuis 7.8
distribution (`tools/fetch-cuis.sh` → `Cuis7-8-main/`) and the OpenSmalltalk VM source
(`tools/fetch-vm.sh` → `opensmalltalk-vm/`). Idempotent — safe to re-run; pass `-f`/`--force`
to re-fetch both from scratch. Each script also works standalone if you only need one.

Separately, the bridge server can install its own shared, per-user copy of Cuis under
`~/.cuis-mcp-bridge/cuis/<key>/` (used by the `run_smalltalk` MCP tool). It is
fetched on demand, pinned to a specific upstream commit, and independent of
`tools/setup.sh` / `tools/fetch-cuis.sh` (which fetch the unpinned `main` into
`Cuis7-8-main/`), so the two Cuis copies can differ. See `mcp-bridge/README.md`.

From there:

- **To build and run the MCP bridge** — see `mcp-bridge/README.md`.
- **To build the local OpenSmalltalk VM, or add/build a plugin** — see
  `vm-exploration/docs/HowToBuild.md` and `vm-exploration/docs/PluginManual.md`.

Building the VM itself and its plugins (`vm-exploration/`) is macOS/arm64-specific so far.
The bridge (`mcp-bridge/`) has no such constraint beyond what Cuis and Node.js need.

## Testing

This repo's test suite has three parts. The two Cuis-based ones share a headless-testing
approach: run a Cuis `.st` script against a **frozen, known-good** image/sources/changes
triplet copied into a disposable scratch directory — never the shared, mutable working image
— under a watchdog timeout, with a deterministic exit code (`0` pass, `1` failure, `124`
timeout, `2` setup error). This avoids one test run's image mutations bleeding into the next,
and keeps a hang from blocking CI indefinitely.

- `tools/run-headless-tests.sh <script.st>` — against the shipped Cuis VM
  (`Cuis7-8-main/CuisVM.app`). Used by the bridge's own test suite
  (`mcp-bridge/image/run-tests.st`).
- `npm test --prefix mcp-bridge/server` — the bridge's Node/TypeScript (Vitest) suite. No VM
  boot, no isolation dance — plain, fast, in-process. The shared-Cuis unit tests need no real
  Cuis. An opt-in integration test downloads the real pinned archive and boots the real VM
  (macOS only): from `mcp-bridge/server`, run
  `CUIS_INTEGRATION=1 npx vitest run src/cuisHome/realCuis.integration.test.ts`.
- `tools/run-vm-primitive-test.sh <script.st>` — against the **locally-built** VM
  (`opensmalltalk-vm/`), so it can see our own plugins. Used by
  `vm-exploration/image/run-check.st` to verify `DummyPlugin`/`DummyPluginZig` return their
  real primitive output, not a Smalltalk fallback. `tools/setup.sh` only fetches VM *source*,
  so this script builds the VM (`tools/build-local-vm.sh`) if it isn't there yet, then always
  (re)builds and installs the plugins (`tools/install-local-plugins.sh`) before running —
  `tools/setup.sh` + this script alone is enough to get from a bare checkout to a passing
  plugin test. Slow on a cold run (a few minutes to build the VM once); macOS/arm64 only.

See `.claude/skills/test-cuis-mcp-bridge/SKILL.md` for the exact commands and expected output
for all three.

For quick Smalltalk or SUnit checks outside these suites, an assistant can use the
`run_smalltalk` MCP tool (see `mcp-bridge/README.md`); it runs the code in a transient headless
Cuis built from the shared Cuis, not the scripts above.
