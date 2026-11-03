---
status: archived
archived: 2026-11-03
started: 2026-09-03
spec: initiatives/cuis-mcp-bridge/technical-spec.md
last-completed-phase: 13
---

# Implementation Log: Cuis MCP Bridge

Building two new components under `mcp-bridge/` in this repo: a Cuis-side Smalltalk
package (`mcp-bridge/image/`) exposing read-only reflection (categories, classes,
protocols, methods, source, class definitions/comments) over a local TCP/NDJSON socket,
and a Node.js/TypeScript bridge process (`mcp-bridge/server/`) that speaks MCP to Claude
Code on one side and that socket protocol on the other. Neither component exists yet, and
neither language has a working test harness in this repo, so both get an inserted
Scaffold phase for their test runner ahead of their first TDD phase.

Phase plan:

1. [Scaffold] mcp-bridge/image/MCP-Bridge.pck.st scaffold — package manifest,
   !provides:/!requires:, MCP-Bridge category, requires JSON
2. [Scaffold] mcp-bridge/PROTOCOL.md — NDJSON schema, protocol version, error codes
3. [Scaffold] Cuis test harness — Tests-MCP-Bridge.pck.st shell (TestCase subclass,
   empty setUp/tearDown) + run-tests.st headless runner, verified exits 0 on empty suite
4. [TDD] McpBridgeServer — start/stop, ConnectionQueue accept loop, localhost bind,
   single-session enforcement, inactivity timeout (invariants 11, 15, 20, 21)
5. [TDD] McpBridgeConnection — NDJSON read/write loop, version handshake, dispatch,
   structured error responses (invariants 9, 10, 14, 22)
6. [TDD] Reflection operations — 7 tool methods, alphabetical sort, not_found handling
   (invariants 2, 4-8, 16-18)
7. [Scaffold] mcp-bridge/server/ scaffold — package.json, tsconfig.json,
   @modelcontextprotocol/sdk dependency
8. [Scaffold] Node test harness — vitest install + config, verify exits 0 on empty suite
9. [Scaffold] src/protocol.ts — TS types + error code constants mirroring the schema
   (pure types/constants, no branching logic)
10. [TDD] src/cuisClient.ts — TCP client: connect/handshake/reconnect/timeout/
    request-queue (invariants 12, 13, 14, 19)
11. [TDD] src/tools.ts — 7 MCP tool adapters, error-code translation
12. [Scaffold] src/index.ts — MCP server entrypoint, stdio transport, tool registration
13. [Scaffold] mcp-bridge/README.md — manual setup + Claude Code MCP registration steps

Starting from phase 1. Done means all 13 phases complete: both packages fileIn/build
cleanly, the Cuis-side SUnit suite and the Node test suite both pass headlessly, and
every file in the Proposed changes section of the technical spec exists with the
behavior described there. End-to-end manual verification (technical spec step 14) is
out of scope for this log — it happens later via `/spec-verify-dynamic`.

## Phase Plan

1. [Scaffold] mcp-bridge/image/MCP-Bridge.pck.st scaffold
2. [Scaffold] mcp-bridge/PROTOCOL.md
3. [Scaffold] Cuis test harness (Tests-MCP-Bridge.pck.st shell + run-tests.st)
4. [TDD] McpBridgeServer
5. [TDD] McpBridgeConnection
6. [TDD] Reflection operations (7 tools)
7. [Scaffold] mcp-bridge/server/ scaffold
8. [Scaffold] Node test harness
9. [Scaffold] src/protocol.ts
10. [TDD] src/cuisClient.ts
11. [TDD] src/tools.ts
12. [Scaffold] src/index.ts
13. [Scaffold] mcp-bridge/README.md

## Phase 1 — [Scaffold] mcp-bridge/image/MCP-Bridge.pck.st scaffold

Wrote the package manifest scaffold: `!provides: 'MCP-Bridge' 1 1!`, `!requires:
'Cuis-Base' 60 5557 nil!` and `!requires: 'JSON' 1 29 nil!` (version corrected to match
JSON.pck.st's actual `!provides: 'JSON' 1 29!`), `SystemOrganization addCategory:
#'MCP-Bridge'!`. No classes/methods yet — pure manifest, matching
`Cuis7-8-main/Packages/Features/JSON.pck.st`'s header shape, `WebClient.pck.st`'s
multi-`!requires:` convention, and `Network-Kernel.pck.st`'s hyphenated
quoted-symbol category convention.

Headless-VM verification (`-headless <image> -s <script>`) proved unreliable in this
environment: identical fileIn scripts against an untouched image sometimes exited in
seconds and sometimes hung indefinitely (near-zero CPU, consistent with a blocked
modal with no display attached). Isolated further and found two suspect patterns: (1)
`FileStream forceNewFileNamed:`/writes under `/private/tmp` intermittently hung on
their own with no fileIn involved; (2) plain read-only fileIn of `JSON.pck.st` was
itself nondeterministic across otherwise-identical runs. This is an environment
reliability issue, not a defect in the package content — confirmed by repeatedly
checking the on-disk image file's mtime/md5 stayed constant throughout (never
corrupted or modified). **Risk for phase 3**: `run-tests.st` must plan for
retry/timeout around VM invocations and should avoid `FileStream` writes from scripts
for status signaling — prefer exit codes, and treat those with caution too.

**Fileln ordering requirement discovered**: `MCP-Bridge.pck.st` requires `JSON`
already loaded — any script or workflow fileIn-ing `MCP-Bridge.pck.st` (phase 3's
`run-tests.st`, and a developer's manual File List load) must fileIn
`Cuis7-8-main/Packages/Features/JSON.pck.st` first.

Files written: `mcp-bridge/image/MCP-Bridge.pck.st`.

## Phase 2 — [Scaffold] mcp-bridge/PROTOCOL.md

Wrote the wire-protocol reference doc: transport (TCP, NDJSON, port 6789, loopback-only,
request/response not pipelined), a single-integer `PROTOCOL_VERSION` starting at 1, the
handshake (reuses the generic envelope with `op: "handshake"`), the generic
`{"ok": true/false, ...}` envelope, all 7 operations with request/response shapes and
sorted/empty/not-found semantics, and all 6 error codes with example payloads and the
invariant(s) each satisfies.

Decisions made where the specs were silent on exact wire-level detail (all called out
inline in the doc itself): boolean `ok` discriminator; `list_protocols` returns
`{"instance": [...], "class": [...]}`; `get_class_definition` fields are snake_case
(`instance_variable_names`, `class_variable_names`); `session_busy` is the one message
sent before any handshake (no session slot to negotiate on); `unreachable` is
bridge-side-only and never appears on the wire from Cuis.

Files written: `mcp-bridge/PROTOCOL.md`.

## Phase 3 — [Scaffold] Cuis test harness (Tests-MCP-Bridge.pck.st shell + run-tests.st)

Wrote `mcp-bridge/image/Tests-MCP-Bridge.pck.st` (empty `McpBridgeTests` `TestCase` shell,
`setUp`/`tearDown` only, no test methods yet — matches `Tests-Network.pck.st`'s
convention) and `mcp-bridge/image/run-tests.st` (headless SUnit runner).

This phase hit a major environment discovery, worth keeping for every future phase that
runs the Cuis VM headlessly. The initial `run-tests.st`, written per the technical spec's
literal example (`FileStream readOnlyFileNamed: ... fileIn`), hung indefinitely under
`-headless` — not the VM-startup flakiness suspected in phase 1, but a real bug: `FileStream`
does not exist as a class in this Cuis 7.8 image. Referencing an undeclared variable/unknown
selector in a doit triggers an interactive "please correct or cancel" Morphic dialog
(`UndeclaredVariable`/`UnknownSelector`, both `ParserNotification` subclasses) — with no
display attached under `-headless` and no stdin to answer a prompt, it blocks forever with
near-zero CPU, which looks exactly like a hang. This was diagnosed interactively (user ran
snippets in a live Workspace and screenshotted the dialogs) since the popup is pure in-memory
Morphic state, never written to any log.

**The verified fix, now baked into `run-tests.st`:**
1. Use `CodePackageFile installPackage: (DirectoryEntry currentDirectory // 'relative/path')`
   to load `.pck.st` files — not `FileStream`/`fileIn`. It also auto-resolves `!requires:`.
2. Wrap installs in `on: ParserNotification do: [:ex | ex resume: nil]` — safely no-ops any
   confirm-dialog-class notification instead of hanging, and logs what triggered it.
3. Do **not** catch `ProgressInitiationException` (fired 3x per package install) with a
   broader handler like `on: Exception do:`. Its `defaultAction` is where the real
   install work happens — it invokes an internal work-block that does the actual fileIn/
   compile, then resumes with the result. Swallowing it and resuming `nil` silently
   skips the real work while the outer code still reports "successfully installed" — a
   dangerous false-positive discovered by checking `Smalltalk includesKey: #ClassName`
   after each install and finding it `false` despite the success message.
4. Reference a freshly-installed class via `(Smalltalk at: #ClassName)`, not the literal
   identifier — the whole `.st` file compiles as one unit before any statement runs, so a
   literal reference to a not-yet-existing class binds to a stale `Undeclared` association
   that never gets patched once the real class is defined moments later.
5. `Transcript logToStdout: true` (an existing Cuis debug aid) routes all `Transcript`
   output to stdout, making headless runs self-diagnosable via redirected output instead
   of requiring a live GUI to see what happened.

Live-verified: exit code 0 in under 1 second, `Package JSON/MCP-Bridge/Tests-MCP-Bridge
successfully installed`, `0 run, 0 passes, ... 0 errors` (correct for an empty suite).
Image file confirmed byte-identical (mtime/md5) before and after. `MCP-Bridge.pck.st` and
`Tests-MCP-Bridge.pck.st` needed no changes — only `run-tests.st`'s script logic was wrong.

Files written: `mcp-bridge/image/Tests-MCP-Bridge.pck.st`, `mcp-bridge/image/run-tests.st`.

## Phase 4 — [TDD] McpBridgeServer

4 cycles, covering invariants 11, 15, 20, 21:

1. **`startOn:`/`stop` lifecycle** — `testStartOnMakesServerReachableViaTcp`: `McpBridgeServer startOn: aPort` makes the server reachable via a real client `Socket` connect. Backed by a `ConnectionQueue` (class-side ivar). Refactor: none needed.
2. **Loopback-only bind (invariant 15)** — `testStartOnBindsOnlyToLoopback`: found that `ConnectionQueue`'s public constructor always binds to all interfaces (`forHost: ''`), violating invariant 15. Fixed by adding `McpBridgeConnectionQueue` (subclass of `ConnectionQueue`) overriding `createListeningSocketWithBacklog:` to bind `'127.0.0.1'` specifically. Also had to override `listenLoop` — this Cuis 7.8 image's `NetNameResolver useOldNetwork` defaults to true, so the "old network" code path (raw `Socket listenOn:backlogSize:`, no interface arg) is what actually runs, not the `createListeningSocketWithBacklog:` path alone. This is exactly the "confirm which path the target platform takes" risk the technical spec flagged in advance. Refactor: trimmed the necessarily-duplicated `listenLoop` override's copied doc comment to a short note explaining why the override exists and to keep it in sync with the original.
3. **`session_busy` rejection (invariant 20)** — `testSecondConnectionWhileOneActiveGetsSessionBusy`: added a polling loop (`pollLoop`, forked process) that tracks one raw `Socket` as `activeSocket` (a stand-in for `McpBridgeConnection`, which doesn't exist until phase 5) and rejects a second concurrent connection with the `session_busy` NDJSON envelope from `PROTOCOL.md`, encoded via `Json render:`. Refactor: none needed (reviewed, already minimal/clear).
4. **Inactivity timeout (invariant 21)** — `testStaleActiveConnectionIsFreedAfterInactivityTimeout`: a still-TCP-connected but silent `activeSocket` is now freed after `inactivityTimeoutSeconds` (test-shortened via a settable class-side accessor, default 60s in production) regardless of TCP-level state, using `Time millisecondClockValue` for elapsed time. Refactor: extracted `pollLoop`'s two responsibilities into `checkInactivityTimeout` and `acceptOrRejectIncomingConnection`; added a class comment to `McpBridgeServer` documenting its role now that the phase is complete.

All 4 tests pass together (headless run <2s including the ~1s timeout test's wait). Image confirmed byte-identical (mtime/md5) across every verification run in this phase.

Files written/modified: `mcp-bridge/image/MCP-Bridge.pck.st` (added `McpBridgeServer`, `McpBridgeConnectionQueue`), `mcp-bridge/image/Tests-MCP-Bridge.pck.st` (4 test methods).

## Phase 5 — [TDD] McpBridgeConnection

5 cycles, covering invariants 9, 10, 14, 22. Added `McpBridgeConnection` (wraps a socket, forks its own request-loop process) and wired `McpBridgeServer`'s `acceptOrRejectIncomingConnection` to create and start one whenever a socket becomes active.

1. **Handshake success** — `testHandshakeRequestGetsSuccessResponse`: reads the handshake request line, decodes with `Json`, replies with `{"ok": true, "result": {"protocol_version": 1}}`. First appearance of `McpBridgeConnection`. Refactor: none needed.
2. **Handshake mismatch (invariant 14)** — `testHandshakeRequestWithMismatchedVersionGetsProtocolMismatchError`: mismatched `protocol_version` gets the `protocol_mismatch` envelope ("expected `<server>`, got `<client>`", matching `PROTOCOL.md`'s wording exactly) and the socket is destroyed (connection torn down, per protocol doc). Introduced `sendError:message:` helper. Refactor: extracted `handleHandshake:` out of `requestLoop` to keep the dispatcher flat ahead of more branches landing in later cycles.
3. **Malformed JSON (invariants 9, 10)** — `testMalformedJsonAfterHandshakeGetsInvalidRequestError`: turned `requestLoop` into a real repeating loop (previously it processed exactly one line and stopped); a `JsonSyntaxError` while decoding now yields `invalid_request` and the loop continues (socket not destroyed) — proving invariant 10 (errors don't kill the session). Refactor: extracted `parseRequest:`; relocated the post-dispatch `socket isConnected` check to sit specifically inside the handshake branch (the only place that destroys the socket), rather than as a blanket check after every dispatch.
4. **Unrecognized op** — `testUnrecognizedOpAfterHandshakeGetsInvalidRequestError`: any `op` other than `'handshake'` also gets `invalid_request` (`'unrecognized operation: <op>'`), loop continues. Refactor: fixed genuinely uneven indentation left by a prior agent's sequential single-line edits (formatting only, no logic change); deliberately did not build a dispatch-table abstraction for one real op + one fallback — deferred to phase 6 when there's an actual set of operations to route to.
5. **`internal_error` (invariant 22)** — `testHandshakeWithNonObjectParamsGetsInternalError`: since no real reflection operations exist yet, used a naturally-occurring type-mismatch (`{"op": "handshake", "params": "oops"}` — a JSON string where a dictionary was expected) to trigger a genuine uncaught `Error` inside dispatch, wrapped the dispatch portion of `requestLoop` in `on: Error do:` converting it to `internal_error` without destroying the socket. **Notable correction during refactor**: the first GREEN attempt built a fragile `dispatchErrorTextFor:` that walked the exception's `signalerContext`/`sender` chain to reverse-engineer which selector "our own code" called, purely to match an overly-precise test string (`doesNotUnderstand: #at:ifAbsent:`) — this depended on Cuis's internal `Collection`/`SequenceableCollection` implementation details and would silently break on any internal library change. Since `PROTOCOL.md` never pinned exact `internal_error` wording, both the implementation (now just `ex messageText`, generic for any `Error`) and the test's expected string (now `String>>between:and:`, the real natural output) were simplified together — the envelope shape, error code, and connection-survives semantics were preserved; only the incidental exact wording changed.

All 9 tests pass together, headless run <2s including the phase-4 timeout test's ~1s wait. Image confirmed byte-identical (mtime/md5) across every verification run in this phase.

Files written/modified: `mcp-bridge/image/MCP-Bridge.pck.st` (added `McpBridgeConnection`), `mcp-bridge/image/Tests-MCP-Bridge.pck.st` (5 test methods).

## Phase 6 — [TDD] Reflection operations (7 tools)

~14 cycles total across all 7 operations (`list_categories`, `list_classes`, `list_protocols`,
`list_methods`, `get_method_source`, `get_class_definition`, `get_class_comment`), covering
invariants 2, 4-8, 16-18. Each operation followed the same arc: happy path (sorted where
applicable) → not_found for missing target → refactor. Two operations' `not_found` came free
via the `resolveClassNamed:` helper (reused across 5 handlers) and were locked in with
documented regression tests rather than forcing an artificial red phase — a deliberate,
TDD-lesson-aligned choice, not an oversight.

**Real bugs this phase's tests caught before they shipped:**
- `SystemOrganization categories` returns `Symbol`s, not `String`s — a naive `includes:`
  comparison against the request's `String` category would always silently fail. Caught by
  the `list_classes` not_found cycle.
- `ClassDescription>>comment` returns a hardcoded placeholder template string ("Main comment
  stating the purpose of this class...") for a class with NO comment set — it does NOT
  return `nil`. Without the invariant-6 cycle's test, uncommented classes would have leaked
  this fake template text to API consumers as if it were real documentation. Fixed via
  `hasComment` check.
- `get_method_source`'s `side` parameter wasn't validated against `invalid`/garbage values
  (silently fell back to instance side) — caught during an end-of-checkpoint refactor review,
  not a dedicated red cycle, and fixed to match `list_methods`'s existing validation.

**Design decisions worth remembering:**
- Dispatch is a `Dictionary` (`operationHandlers`, op-name string → selector symbol) with
  `perform:with:` — introduced at cycle 1 of this phase specifically to avoid a
  many-levels-deep `ifTrue:ifFalse:` chain as operations accumulated.
- Shared helpers extracted incrementally, each only after a genuine 2nd occurrence (not
  speculatively): `sortedStringArrayFrom:`, `paramNamed:from:`, `resolveClassNamed:` (resolves
  or sends `not_found` itself and returns `nil` — callers do `aClass ifNil: [^self]`),
  `resolveClassFromRequest:`, `target:forSide:`, `resolveSide:`.
- One early test-design mistake, caught and fixed: the `list_protocols`/`list_methods` happy
  tests originally asserted this project's OWN class's protocol/method lists via exact match
  — coupling test pass/fail to incidental categorization choices in the very code being
  written. Relaxed to "includes known entries + stays sorted" assertions, consistent with the
  `internal_error` message-text precedent from phase 5.
- `instance_variable_names`/`class_variable_names` in `get_class_definition` are NOT sorted
  (declaration order for ivars; `PROTOCOL.md` doesn't mandate sorting there) — deliberately
  different from every other list-returning operation, which are all alphabetically sorted
  per invariant 2.

Final state: 23 passing SUnit tests, headless run completes in ~2-3s. Image confirmed
byte-identical (mtime/md5) across every one of this phase's ~40+ verification runs.

Files written/modified: `mcp-bridge/image/MCP-Bridge.pck.st` (all 7 `handle*:` methods +
shared helpers), `mcp-bridge/image/Tests-MCP-Bridge.pck.st` (23 total test methods across
phases 4-6).

## Phase 7 — [Scaffold] mcp-bridge/server/ scaffold

`package.json` (name `cuis-mcp-bridge`, ESM `"type": "module"`, `@modelcontextprotocol/sdk`
`^1.30.0` — the real current published version, verified via `npm view`), TypeScript +
Vitest as dev dependencies (Vitest chosen per the technical spec's suggestion; left
unconfigured — that's phase 8's job). `tsconfig.json`: ES2022 target, `NodeNext`
module/resolution (matches the SDK's own ESM requirement), strict mode. A placeholder
`src/index.ts` (`export {};`) exists only so `tsc` has something to compile — no real logic,
per this phase's scaffold-only scope. Added a `.gitignore` scoped to `mcp-bridge/server/`
for `node_modules/`/`dist/`.

Verified: `npm install` succeeds (145 packages, 0 vulnerabilities), `npx tsc --noEmit` and
`npm run build` both succeed cleanly. Did not touch `mcp-bridge/image/` or write any of the
later phases' files (`src/protocol.ts`, `src/cuisClient.ts`, `src/tools.ts`, real
`src/index.ts`, `README.md`).

Files written: `mcp-bridge/server/package.json`, `mcp-bridge/server/tsconfig.json`,
`mcp-bridge/server/src/index.ts` (placeholder), `mcp-bridge/server/.gitignore`,
`mcp-bridge/server/package-lock.json`.

## Phase 8 — [Scaffold] Node test harness

`mcp-bridge/server/vitest.config.ts` with `environment: 'node'` and `passWithNoTests: true`.
Empirically confirmed the installed Vitest (3.2.7) exits 1 on zero test files by default —
used `passWithNoTests` rather than a placeholder test file, to keep `src/` free of
scaffold-only content a later `tdd-red` agent would need to notice/remove. `package.json`'s
`test` script now runs `vitest run` (replacing phase 7's placeholder echo). Verified: `npm
test` exits 0 cleanly ("No test files found, exiting with code 0").

Files written: `mcp-bridge/server/vitest.config.ts`; modified: `mcp-bridge/server/package.json`
(`test` script only).

## Phase 9 — [Scaffold] src/protocol.ts

Pure TypeScript type/constant declarations mirroring `mcp-bridge/PROTOCOL.md` exactly:
`PROTOCOL_VERSION`, the 6-member `ErrorCode` union, generic `McpBridgeSuccess<T>`/
`McpBridgeFailure`/`McpBridgeResponse<T>` envelopes, per-operation params/result
interfaces for all 7 reflection operations plus a `McpBridgeOperationRequest`
discriminated union, and the handshake request/response types. No runtime logic — this
phase was deliberately classified Scaffold, not TDD, since there's no branching logic to
drive with a failing test. Compiles cleanly under strict TS + ESM/NodeNext resolution;
`npm test` still passes empty.

Files written: `mcp-bridge/server/src/protocol.ts`.

## Phase 10 — [TDD] src/cuisClient.ts

8 cycles, covering invariants 12, 13, 14, 19. Built `CuisClient`: `connect()` (TCP + NDJSON
handshake), `sendRequest<T>(op, params)` (the actual tool-call path), `ProtocolMismatchError`
and `UnreachableError` typed error classes, connect and per-request timeouts, transparent
one-shot reconnect on a dead socket, and a promise-chain request queue serializing concurrent
calls onto one wire-level request at a time.

1. Connect + handshake success — first appearance of `CuisClient`, tested against a fake
   `net` TCP server spun up per-test on an ephemeral port (the pattern used throughout).
2. `protocol_mismatch` → typed `ProtocolMismatchError`.
3. `unreachable` on connect-level socket error (e.g. `ECONNREFUSED`) → typed `UnreachableError`.
4. `sendRequest<T>()` — the missing piece for actually calling a reflection operation after
   the handshake. **Caught and fixed a real production bug during this cycle's GREEN**: to
   satisfy a test-cleanup issue (`net.Server.close()` blocking on open connections), GREEN
   added a `setImmediate`-based auto-close on the client socket — which would have silently
   dropped the persistent connection before its first real use in production if any async
   gap longer than one macrotask occurred between `connect()` and the first `sendRequest()`
   (extremely plausible in real usage). Root-caused and fixed properly in refactor: removed
   the auto-close entirely from production code, fixed the actual problem in the tests'
   fake-server cleanup (track and force-destroy accepted sockets in `afterEach`) instead.
5. Per-request timeout → `unreachable`, via a shared `armPending` timer/settle helper.
6. Connect timeout (distinct from per-request timeout, per the technical spec's own framing)
   → `unreachable`; extracted `armPending` to serve both `connect()` and `sendRequest()`.
7. Reconnect after mid-session disconnect (invariant 13) — a `'close'` socket listener clears
   `this.socket` and fast-rejects any pending request; `sendRequest()` attempts exactly one
   reconnect+retry before propagating failure.
8. Request queue serialization (invariant 19) — a `requestChain: Promise<void>` that each
   `sendRequest()` call appends its own runner onto, returning its own distinct promise (not
   the chain's tail value) so concurrent callers each get their own correct, non-swapped
   result while the wire only ever sees one unanswered request at a time.

Final state: 8 passing Vitest tests, run completes in ~500ms, zero flakiness across every
double/triple verification run this phase required (concurrency and timing-sensitive tests
were re-run repeatedly to confirm).

Files written: `mcp-bridge/server/src/cuisClient.ts`, `mcp-bridge/server/src/cuisClient.test.ts`.

## Phase 11 — [TDD] src/tools.ts

2 cycles (scoped broader than earlier phases given the session's cycle budget). Built
`createTools(client: CuisClient): ToolDefinition[]`, the MCP tool adapter layer.

1. All 7 tool definitions' success paths at once (name/description/inputSchema per
   `PROTOCOL.md`, shared handler calling `client.sendRequest(name, args)` and wrapping the
   result as `{content: [{type: 'text', text: JSON.stringify(result)}]}`), tested against a
   mock `CuisClient` (not a real TCP server — appropriate at this layer, since it's testing
   adaptation logic, not networking).
2. Error-code mapping — required a fix in `cuisClient.ts` too: its catch-all error branch was
   discarding the actual Cuis-side error code (`not_found`/`invalid_request`/etc.), reducing
   every non-`protocol_mismatch` failure to an untyped generic `Error`. Added `CuisResponseError`
   (carrying `.code`) alongside the existing `ProtocolMismatchError`/`UnreachableError`, all
   three refactored onto a shared `CuisClientError` base (removing the 3x-duplicated
   `{code, message, name}` boilerplate). `tools.ts`'s handler now catches any rejection, maps
   a coded error to `{content: [...], isError: true}` with the code/message preserved for
   Claude Code to distinguish, and falls back gracefully for uncoded errors.

Final state: 10 passing Vitest tests across `cuisClient.test.ts` (8) and `tools.test.ts` (2),
zero flakiness across repeated verification runs.

Files written: `mcp-bridge/server/src/tools.ts`, `mcp-bridge/server/src/tools.test.ts`;
modified: `mcp-bridge/server/src/cuisClient.ts` (added `CuisClientError`/`CuisResponseError`).

## Phase 12 — [Scaffold] src/index.ts

Thin MCP stdio entrypoint wiring `CuisClient` + `createTools` into the
`@modelcontextprotocol/sdk`'s server. Used the low-level `Server`/`setRequestHandler`
API (not the higher-level `McpServer.registerTool()`) specifically because
`registerTool`'s `inputSchema` parameter expects a Zod shape, while `tools.ts`'s
`ToolDefinition.inputSchema` is already plain JSON Schema — the low-level
`ListToolsRequestSchema`/`CallToolRequestSchema` handlers accept that directly with
no conversion, avoiding a new dependency or translation layer. Deliberately does NOT
call `client.connect()` at startup — `CuisClient.sendRequest()` (phase 10) already
auto-connects lazily, so the bridge process can start before the Cuis image does, per
the technical spec. Port 6789 / host 127.0.0.1 match `PROTOCOL.md` exactly.

Verified: `tsc --noEmit` clean, `npm run build` produces `dist/index.js`, the built
process starts and idles on stdio without crashing, and the existing 10-test suite is
unaffected.

Files written: `mcp-bridge/server/src/index.ts`.

## Phase 13 — [Scaffold] mcp-bridge/README.md

Wrote the practical developer setup guide: what the bridge is, prerequisites, building
the Node process (`npm install && npm run build`), loading `MCP-Bridge.pck.st` via File
List (noting its `JSON`/`Network-Kernel` `!requires:` and typical availability in a stock
image), starting/stopping the Cuis-side server via a Workspace doIt
(`McpBridgeServer startOn: 6789.` / `McpBridgeServer stop.`), registering the built
`dist/index.js` in Claude Code's `.mcp.json`, the 7 available tools (descriptions pulled
verbatim from `tools.ts`'s `TOOL_METADATA`, not reinvented), and a troubleshooting section
mapping each of the 6 error codes to what a developer should actually do about it. Every
command, path, and class/method name was cross-checked against the real files rather than
invented.

Files written: `mcp-bridge/README.md`.

## Implementation summary

All 13 phases are complete. The Cuis-side package (`mcp-bridge/image/MCP-Bridge.pck.st` +
`Tests-MCP-Bridge.pck.st`) implements `McpBridgeServer` (single-session, loopback-only,
polling-based TCP server with an inactivity timeout) and `McpBridgeConnection` (per-socket
NDJSON request loop: handshake, dispatch to 7 reflection operations, structured
`not_found`/`invalid_request`/`internal_error`/`protocol_mismatch`/`session_busy` error
responses) — 23 passing SUnit tests, verified headless in under 3 seconds per run. The
Node.js/TypeScript bridge process (`mcp-bridge/server/`) implements `CuisClient` (TCP
client: connect/handshake, timeouts, one-shot reconnect, request-queue serialization),
`createTools` (the 7 MCP tool adapters with error-code translation), and a thin stdio
entrypoint — 10 passing Vitest tests.

The design evolved from the spec in a few notable ways, all driven by things TDD or live
verification actually caught rather than anticipated up front:
- The technical spec's literal `run-tests.st` example used `FileStream`, which doesn't
  exist in this Cuis 7.8 image — real fix was `CodePackageFile installPackage:` plus
  careful exception handling around `ProgressInitiationException` (phase 3).
- `ConnectionQueue`'s public constructor binds to all interfaces, not loopback as the spec
  assumed — required a subclass overriding both the new-network and old-network binding
  paths (phase 4).
- Two real bugs were caught by tests before shipping: `SystemOrganization categories`
  returns `Symbol`s (not `String`s, breaking a naive `includes:` check), and
  `ClassDescription>>comment` returns a hardcoded placeholder for uncommented classes
  instead of `nil` (which would have leaked fake documentation text to API consumers)
  (phase 6).
- A GREEN-phase agent introduced a `setImmediate`-based auto-close in `CuisClient` to work
  around a test-cleanup issue; this would have been a real production bug (silently
  dropping the persistent connection before first use). Caught during refactor review and
  fixed at the actual root cause (test cleanup), not worked around in production code
  (phase 10).
- Given the session's TDD cycle budget, phases 6 and 10 used full single-behavior-per-cycle
  discipline (~14 and 8 cycles respectively), while phase 11 was deliberately scoped
  broader (2 cycles covering all 7 tools' success paths at once, then error mapping) to
  stay within budget without sacrificing test coverage of the invariants that mattered.

End-to-end manual verification (technical spec step 14 — a real Cuis image, the built
bridge process, and every tool/error path exercised through an MCP client) is out of scope
for this log and happens later, outside this implementation phase.

## Implementation files

- mcp-bridge/image/MCP-Bridge.pck.st
- mcp-bridge/image/Tests-MCP-Bridge.pck.st
- mcp-bridge/image/run-tests.st
- mcp-bridge/PROTOCOL.md
- mcp-bridge/README.md
- mcp-bridge/server/package.json
- mcp-bridge/server/package-lock.json
- mcp-bridge/server/tsconfig.json
- mcp-bridge/server/vitest.config.ts
- mcp-bridge/server/.gitignore
- mcp-bridge/server/src/protocol.ts
- mcp-bridge/server/src/cuisClient.ts
- mcp-bridge/server/src/cuisClient.test.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/server/src/index.ts

## Post-implementation fix: `requestLoop` hang under live/GUI usage

While dogfooding the finished bridge against the real interactive image (not the headless
test harness), `requestLoop` (`McpBridgeConnection`, `MCP-Bridge.pck.st`) was found to hang
the connection permanently under real usage, requiring a manual `McpBridgeServer stop.` /
`startOn:` to recover. Root-caused live, with the image's own Debugger as evidence:

1. **Misdiagnosed first**: `line isEmpty ifTrue: [ ^self ]` treated any empty read from
   `socket receiveDataTimeout: 5` as "peer closed", when an empty read also happens on a
   plain timeout with no data yet and the socket still open. Fixed to only end the loop when
   `socket isConnected` is actually false, letting a mere timeout just loop and retry. This
   fix alone did not resolve the hang.
2. **Real root cause**: `socket receiveDataTimeout: 5` itself raised an unhandled
   `SocketPrimitiveFailed` (`primSocketReceiveDataAvailable: failed`) on a live socket. The
   existing `on: Error do:` in `requestLoop` only wrapped the request-dispatch step, not the
   receive call — so this error propagated unhandled out of the forked request-loop
   `Process`, which under the real (non-headless) image opens an interactive Debugger and
   suspends that process indefinitely. The TCP connection stayed `ESTABLISHED` with nothing
   left to service it, so every subsequent request from the client — even one already known
   to work — hung until the 60s `inactivityTimeoutSeconds` eventually force-destroyed the
   stale `activeSocket`, or the server was restarted by hand. Fixed by also wrapping the
   receive call: `line := [socket receiveDataTimeout: 5] on: Error do: [:ex | ^self].` — any
   receive-time error now ends the loop cleanly instead of opening a debugger.

Added a regression test, `testRequestLoopTerminatesCleanlyWhenSocketReceiveRaisesAnError`,
using a new `McpBridgeFailingSocketStub` test double whose `receiveDataTimeout:` always
raises an `Error` (simulating the real `SocketPrimitiveFailed`) — asserts the request-loop
`Process` terminates itself rather than being left suspended. Verified headless: 24/24 SUnit
tests pass (23 original + 1 new). Also manually verified live against the real interactive
image: reproduced the original hang via repeated `list_methods` calls through the bridge,
applied both fixes via File List re-fileIn, and confirmed the same call sequence — plus a
recursive `get_method_source` call against `requestLoop` itself — now succeeds repeatedly
with no hang.

## Post-implementation: observability + two more stress-testing bugs

Added opt-in Cuis-side observability (`McpBridgeServer verbose: true.`) logging
connection/request activity to `Transcript` — accepted/rejected connections,
inactivity-driven cleanup, and each request's op — timestamped via the same
`DateAndTime now` + `time print24:showSeconds:on:` idiom `SystemDictionary>>setStartupStamp`
uses for its own startup log line. This observability is what surfaced the two bugs below:
their exact `Transcript` timestamps were the deciding evidence in both diagnoses.

**Bug 1 — inactivity timeout measured connection age, not actual silence.**
`activeSocketSetAt` (Cuis side) was set once at accept time and never refreshed, so
`checkInactivityTimeout` measured *time since accept*, not *time since last activity* as the
class comment always claimed ("freed after `inactivityTimeoutSeconds` of silence"). Any
connection older than 60s got force-destroyed by the next 50ms poll tick, mid-use, even while
actively serving requests — trivially reachable in any real (non-benchmark) session, since
LLM-turn-paced tool calls routinely exceed 60s apart. Fixed by renaming the ivar to
`activeSocketLastActivityAt` (honest name, single responsibility) and refreshing it from a new
`McpBridgeServer class>>noteActivityFor:` guarded by identity against the current
`activeSocket`, called from both `McpBridgeConnection>>sendSuccess:` and `>>sendError:message:`
— i.e. after every response actually sent. Regression test:
`testActiveConnectionSurvivesPastInactivityTimeoutWhenRequestsKeepArriving` (two requests,
each within the timeout window of the last, whose combined elapsed time exceeds it). Verified
headless: 27/27 SUnit tests pass (26 + this one; also added 2 tests for the new
`verbose`/`verbose:` accessors).

**Bug 2 — the Node-side handshake response listener never detached, so it kept treating
every later operation error as if it were a handshake failure.** `CuisClient.connect()`
(`cuisClient.ts`) registered `socket.on('data', ...)` to parse the one-shot handshake
response, but never removed that listener afterward. Since every wire response — handshake or
not — shares the same `{ok, ...}` envelope shape, this same listener kept firing for every
subsequent request/response too. Its `else` branch (anything other than `protocol_mismatch`)
unconditionally called `socket.end()` — so *any* ordinary operation error response
(`not_found`, `invalid_request`, etc.) silently closed the connection right after correctly
delivering the error to the caller, and the next request on the (now half-closed) socket
failed with a raw Node `write after end` `unreachable` error instead of running normally.
Root-caused via `verbose` Transcript evidence (exact-second timestamps showing Cuis's own
`socket isConnected` check going false immediately after handling an ordinary `not_found`, not
after any real timeout) cross-checked against `lsof` showing the Node side in `FIN_WAIT_2` —
i.e. the client itself, not Cuis, initiated the close. Fixed by splitting the handshake-only
listener (detached via `socket.off:` once one full line is parsed, handling multi-chunk
fragmentation correctly along the way) from a new steady-state `attachResponseHandler`
installed only after a successful handshake, which resolves/rejects the pending request for
*any* response shape without ever closing the socket — only the handshake-phase listener still
does that, and only for its own two genuinely fatal branches. `attachResponseHandler` also
loops over all complete lines in the buffer per `data` event (`while`, not `if`), fixing a
latent framing bug found alongside it: multiple responses coalesced into one TCP chunk used to
leave everything after the first line stuck unprocessed until the next chunk arrived. Regression
test: `keeps the connection open after an ordinary operation error response, so a later request
on the same connection still succeeds`. Verified: 11/11 Vitest tests pass (10 + this one), and
manually reproduced end-to-end through the live bridge (the exact `category: ''` → `category:
'json'` sequence that used to fail with `write after end` now returns clean `not_found`
responses on the same connection, confirmed via a rebuilt `dist/index.js` and a fresh MCP
reconnect).

## Post-implementation: two more stress-testing findings, plus a self-inflicted false alarm

**Fixed `Transcript` usage against real Cuis convention, discovered by inspecting `Transcript`
itself through the bridge.** The initial `verbose` logging (added above) used `show:`/`newLine`
and a hand-rolled seconds-precision timestamp copied from `SystemDictionary>>setStartupStamp`'s
idiom. Reflecting on `Transcript`'s own class comment and protocols revealed `show:`/`newLine`
are filed under `'old Transcript compatibility'` — legacy — while the actual preferred protocol
is a single method, `Transcript log:`. Its own `addEntry:` already timestamps with **millisecond**
precision (`DateAndTime now printWithMsOn:`, not just seconds), tags each entry with the logging
`Process`'s priority and identity hash, is thread-safe (`accessSemaphore critical:` — matters
here, since `pollLoop` and each connection's `requestLoop` are concurrent `Process`es), and
sanitizes embedded newlines. Rewrote `McpBridgeServer class>>log:` to delegate to `Transcript
log:` instead of reimplementing all of that by hand. Also added `params:` (JSON-rendered via
`Json render:`, matching the wire format instead of `printString`'s Smalltalk-y `an
OrderedDictionary(...)` noise) to the per-request log line. Separately, `Transcript logToFile:
true` (also discovered via its class comment/protocol) writes every entry to a real file —
`Cuis7-8-main-UserFiles/Logs/transcript.txt` — letting the *agent* read connection/request
activity directly instead of relying on the user pasting Transcript screenshots each time.

**Bug — `list_methods` returned an empty list instead of `not_found` for a nonexistent
protocol name.** `handleListMethods:` called `target organization listAtCategoryNamed: protocol
asSymbol` with no existence check, unlike `handleListClasses:`'s explicit `SystemOrganization
categories includes:` guard for the exact same kind of lookup. Root cause: `Categorizer
>>listAtCategoryNamed:` (the Cuis kernel method backing `organization`) silently answers `#()`
for an unknown category name by design — harmless for the kernel's own purposes, but for this
bridge it meant a typo'd protocol name was indistinguishable from a real, empty one. Fixed by
adding the same existence check `handleListClasses:` already had. Regression test:
`testListMethodsRequestForNonexistentProtocolGetsNotFoundErrorNotEmptyList`.

**Design fix — a self-inflicted "false alarm" in the inactivity-cleanup log line, caught by the
user reviewing the new `Transcript` logging output.** Every receive-time error in `requestLoop`
was logged identically as `'connection ended: receive error: ', ex class name, ...` — including
the *entirely expected* `SocketPrimitiveFailed` that fires when `checkInactivityTimeout` had
already destroyed that exact socket a moment earlier (itself already logged separately as `'freed
stale active connection...'`). Read side-by-side, an expected, self-inflicted cleanup looked like
two unrelated alarming errors. First proposed fix — `McpBridgeConnection` asking `McpBridgeServer
isCurrentActiveSocket: aSocket` and branching on the answer — was rightly rejected by the user
for violating tell-don't-ask (the connection querying the server's state to make its own
decision). Corrected to `McpBridgeServer class>>logConnectionEndedFor:aSocket dueTo:anException`:
the connection merely *tells* the server what happened; the server — sole owner of the
`activeSocket` concept — decides entirely on its own whether that's a superseded/expected
closure (`'connection closed (already superseded)'`) or a genuine receive error, mirroring the
`noteActivityFor:` pattern already established for the exact same kind of identity check.
Verified live end-to-end: forced a real 60s-idle cleanup through the bridge and confirmed the
`Transcript` log file shows the quieter message instead of the alarming one.

Headless SUnit: 28/28 passing (27 + the new `list_methods` regression test; the log-severity fix
has no independently observable wire-protocol behavior, so no dedicated test was added for it —
consistent with not asserting `Transcript` content elsewhere in this suite).

## Retrospective

All 13 phases completed (3 image-side scaffold/TDD, 3 reflection/TDD, 5 Node bridge, 2 docs/scaffold). The Cuis-side `McpBridgeServer`/`McpBridgeConnection` and the Node `CuisClient`/`createTools`/stdio entrypoint shipped with SUnit and Vitest suites.

Deviations from the spec, each caught by tests or live use: the spec's `FileStream` test runner doesn't exist in Cuis 7.8 (replaced with `CodePackageFile installPackage:`); `ConnectionQueue` binds to all interfaces, so a loopback-only subclass was needed; `SystemOrganization categories` returns Symbols and `ClassDescription>>comment` returns a placeholder instead of `nil`; and a GREEN-phase `setImmediate` auto-close would have dropped the persistent connection and was fixed at its root cause (test cleanup).

Post-implementation dogfooding found more bugs the headless suite couldn't: `requestLoop` hung on empty socket reads (timeouts were treated as peer-closed), a `list_methods` call with a nonexistent protocol returned an empty list instead of `not_found`, and inactivity-cleanup produced misleading error logs. The last was fixed with tell-don't-ask after the first design was rejected. Final headless SUnit state was 28/28.

Lesson: live use against a real interactive image surfaced socket and timing bugs that headless tests missed. Formal static and dynamic verification reports were never produced for this initiative, and the end-to-end MCP-client verification the spec called for was covered only informally through dogfooding.
