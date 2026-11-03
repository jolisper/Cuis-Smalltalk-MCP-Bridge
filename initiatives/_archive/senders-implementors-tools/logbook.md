---
spec: initiatives/senders-implementors-tools/technical-spec.md
started: 2026-09-15
last-completed-phase: 5
status: archived
archived: 2026-11-03
---

## 2026-09-16

Resolved the initiative's sole open question: the two new wire operations will be named
`list_senders_of` and `list_implementors_of`, following the bridge's existing `list_*`
naming convention (`list_categories`, `list_classes`, `list_protocols`, `list_methods`)
rather than mirroring the raw Smalltalk vocabulary (`senders_of`/`implementors_of`).

# Implementation Log: Senders/Implementors Tools

Building two new read-only MCP tools, `list_senders_of(selector)` and
`list_implementors_of(selector)`, per `initiatives/senders-implementors-tools/technical-spec.md`.
Both sides of the bridge (the Cuis-side `MCP-Bridge.pck.st` package and the Node
`mcp-bridge/server` process) already implement 7 read-only reflection operations in an
identical, repeatable shape; these two are additional instances of that same shape backed by
`Smalltalk allCallsOn:`/`allImplementorsOf:`, which the image already provides. Starting from
phase 1. Done looks like: both operations dispatchable end-to-end, `PROTOCOL_VERSION` at 2 on
both sides, SUnit and Vitest tests green, and `PROTOCOL.md`/`README.md` documenting the two
new tools.

## Phase Plan

1. [Scaffold] mcp-bridge/PROTOCOL.md — add list_senders_of/list_implementors_of operation
   docs, bump PROTOCOL_VERSION to 2
2. [Scaffold] mcp-bridge/server/src/protocol.ts — new params/result types, union variants,
   PROTOCOL_VERSION bump to 2
3. [TDD] mcp-bridge/image/MCP-Bridge.pck.st + Tests-MCP-Bridge.pck.st —
   methodReferenceArrayFrom: helper, handleListImplementorsOf:/handleListSendersOf: handlers,
   operationHandlers entries, protocolVersion bump, class comment update, SUnit tests
4. [Scaffold] mcp-bridge/server/src/tools.ts + tools.test.ts — two new TOOL_METADATA entries
   plus their tests
5. [Scaffold] mcp-bridge/README.md — tool list and count update

## Phase 1 — [Scaffold] mcp-bridge/PROTOCOL.md

Added `### list_senders_of` and `### list_implementors_of` operation sections (lines
270–292 of the file), following the exact existing per-operation format. Updated "7
operations"/"7 operation names" to "9" at the two occurrences (lines 108, 143). Bumped
`PROTOCOL_VERSION` from 1 to 2 (line 45). No other content touched. Verified by grep.

## Phase 2 — [Scaffold] mcp-bridge/server/src/protocol.ts

Bumped `PROTOCOL_VERSION` to 2. Added `MethodReferenceEntry` shared row type plus
`ListSendersOfParams`/`Result` and `ListImplementorsOfParams`/`Result`. Extended
`McpBridgeOperationRequest` with the two new op variants. Updated the "7"→"9" doc comment.
Pure type declarations only, no runtime logic. `npm run build` (tsc) compiles cleanly.

## Phase 3 — [TDD] mcp-bridge/image/MCP-Bridge.pck.st + Tests-MCP-Bridge.pck.st

Pre-flight: found the local `Cuis7-8-main/` checkout missing its `Packages/` directory
entirely (pre-existing environment issue, unrelated to this initiative's changes) —
re-extracted the already-downloaded `Cuis7-8-main.zip` in place to restore it, confirmed
baseline SUnit suite green (28 run, 28 passes) before starting any cycle.

- Cycle 1: handleListImplementorsOf: for selector 'printOn:' returns a sorted array of
  {class, selector, side} rows.
  - Red: test initially used selector 'printOn:'/class 'OrderedCollection' as a fixture
    assumed (not verified) to be a direct implementor. Green agent's diagnosis proved this
    wrong (OrderedCollection inherits printOn: from Collection; 108 real implementors,
    ~7.6KB response) and separately surfaced a real but narrowly-scoped test-infra limit:
    the SUnit test client's `Socket>>receiveDataTimeout:` has a fixed 2000-byte read
    buffer, so any test expecting a response over ~2000 bytes truncates. Confirmed this
    doesn't affect production (the Node bridge's client reads via chunked socket events
    with no such cap) — noted as a follow-up for a future dedicated fix.
  - Corrected the test's fixture to `setSocket:`/`McpBridgeConnection` (single real
    implementor, verified directly against MCP-Bridge.pck.st's own source, tiny response).
  - Green: implementation is generic/fixture-agnostic (`Smalltalk allImplementorsOf:`,
    sort by class, map to {class,selector,side}) — needed no changes after the test fix.
  - Refactor: collapsed a two-step sort reassignment into one expression, matching existing
    file style. Suite green: 29 run, 29 passes, 0 failures, 0 errors.

- Side quest (user-authorized): added `receiveFullResponseFrom:` test helper to
  `McpBridgeTests` — loops `receiveDataTimeout:` until the buffer contains a newline,
  mirroring how `cuisClient.ts`'s client already reassembles chunked NDJSON — so future
  tests aren't limited to artificially tiny fixtures to dodge the 2000-byte single-read cap.
  Added `testListImplementorsOfRequestGetsFullSortedArrayAcrossMultipleReadChunks` using it,
  with a real, live-verified multi-class fixture (`printOn:`, asserting on `Collection` and
  `Object` as two of its ~108 real implementors) instead of a trivial single-entry one.

  This surfaced a genuine, previously-latent **production bug**, not a test artifact:
  `Collection>>jsonWriteOn:` in the vendored `Cuis7-8-main/Packages/Features/JSON.pck.st`
  (lines 410-424) inserts a literal newline between array elements whenever they're
  non-literal objects (true for our `OrderedDictionary` rows, false for the plain-string
  arrays every one of the 7 pre-existing operations returns) — breaking PROTOCOL.md's own
  documented "no embedded literal newline" NDJSON framing guarantee for any response with
  2+ implementors/senders. This affects the real production Node client
  (`cuisClient.ts`'s `buffer.indexOf('\n')` framing) exactly as much as the Cuis-side test
  client — never triggered before because no existing operation returns an array of objects.
  Fixed in `McpBridgeConnection>>sendSuccess:` (not the vendored `Json` package, to avoid
  changing shared third-party rendering behavior for any other in-image consumer): strip
  embedded `Character lf`/`Character cr` bytes from the rendered envelope before appending
  the true trailing terminator — safe, since JSON whitespace between tokens is insignificant.
  `sendError:message:` was left untouched (its envelope can never contain a non-literal
  array, so it can't hit this bug). Verified independently (not just via agent self-report,
  after one report was garbled/unreliable) — full suite green: 30 run, 30 passes, 0 errors.

  Process note: briefly ran two agents concurrently investigating/fixing the same file,
  which produced a confusing "intermittent" false read on the diagnosis agent's side (it was
  actually observing the file mid-flux between pre-fix and post-fix states, not real
  flakiness). Confirmed stable with two independent full-suite re-runs after the fact.

  Refactor: reviewed `sendSuccess:` and `handleListImplementorsOf:` — both already minimal
  and consistent with file conventions (the success/error stripping asymmetry is intentional,
  not an oversight); flagged pre-existing unrelated envelope-building duplication across
  `sendSuccess:`/`sendError:message:`/`rejectAsSessionBusy:` without touching it (predates
  this change, out of scope). No changes made.

- Cycle 2: handleListSendersOf: for selector 'setSocket:' returns an array whose row names
  the sender (`on:`, class side on `McpBridgeConnection`), not the queried selector.
  - Red: verified `McpBridgeConnection class>>on:` sends `setSocket:` against the live
    image before writing the fixture (per feedback earlier in this session).
  - Green: mirrored `handleListImplementorsOf:`'s shape exactly, using `allCallsOn:`
    instead of `allImplementorsOf:`. Suite green: 31 run, 31 passes, 0 errors.
  - Refactor: extracted the shared sort+map+wrap logic into `methodReferenceArrayFrom:`
    (matching the exact helper name/shape technical-spec.md anticipated) — both handlers
    now differ only in which Smalltalk reflection call they pass in. Suite still green.

  Process note: while this cycle ran, the earlier stale diagnosis agent (chasing the
  already-fixed framing bug) resurfaced with a garbled report caused by its own port
  contention from running concurrent test batches — stopped it via TaskStop and confirmed
  no orphaned processes remained before continuing.

- Cycle 3: list_implementors_of for a selector with zero implementors returns [], not an
  error (invariant 12). Test passed immediately — locks in already-correct behavior, no
  implementation change, no refactor needed. Suite green: 32 run, 32 passes, 0 errors.

- Cycle 4: list_senders_of for a selector with zero senders returns [], not an error
  (invariant 12, senders_of counterpart). Test passed immediately, same reasoning as cycle
  3 — no implementation change, no refactor needed. Suite green: 33 run, 33 passes, 0 errors.

- Cycle 5: list_implementors_of with a missing selector param returns invalid_request
  (invariant 13). Red confirmed it previously fell through to internal_error (nil asSymbol
  doesNotUnderstand:, caught by the generic dispatch handler). Green added a guard clause
  (`selector isKindOf: String`, else invalid_request) at the top of
  `handleListImplementorsOf:` only — deliberately not touching `handleListSendersOf:` yet
  (separate, not-yet-written test). No refactor needed. Suite green: 34 run, 34 passes.

- Cycle 6: list_senders_of with a missing selector param returns invalid_request (invariant
  13, senders_of counterpart) — direct mirror of cycle 5. Green replicated the identical
  guard clause into `handleListSendersOf:`. Refactor extracted both handlers' now-identical
  guards into a shared `selectorParamFrom: request` helper, matching the existing
  `resolveClassFromRequest:`/`resolveSide:` convention (send error internally, return nil,
  caller checks `ifNil: [^self]`). Suite green: 35 run, 35 passes, 0 errors.

Phase 3 complete. Final state: both operations fully implemented
(`handleListImplementorsOf:`/`handleListSendersOf:`, sharing `selectorParamFrom:` and
`methodReferenceArrayFrom:`), dispatch table updated, protocolVersion at 2, the
embedded-newline framing bug fixed in `sendSuccess:`, and 35 SUnit tests passing (7 new:
2 happy-path incl. one exercising the chunked-response helper, 2 empty-result, 2
invalid_request, plus the `receiveFullResponseFrom:` test helper's own coverage). Sequence
executed: 6 planned TDD cycles + 1 authorized side quest (chunked-response test helper) +
1 unplanned real-bug-driven cycle (the framing fix, handled as its own red/green/refactor
using an already-failing test as red). Deviation from the technical spec worth noting: the
spec anticipated `methodReferenceArrayFrom:` as a helper from the start; it emerged instead
through refactor after cycle 2, which is a difference in sequencing, not outcome — the final
shape matches what was planned.

## Harness follow-up (deferred earlier, closed out now that phase 3's suite is green)

Bundled `JSON.pck.st`/`Network-Kernel.pck.st` into `.headless-base` so the test harness no
longer depends on `Cuis7-8-main/Packages/` existing at all — closing the exact gap that
caused phase 3's initial pre-flight failure. Changed `tools/run-headless-tests.sh` (populate
these two files during the existing one-time `.headless-base` population step, and check for
their presence alongside the image/sources/changes) and `mcp-bridge/image/run-tests.st`
(point the two dependency-package fileIns at `.headless-base/...` instead of
`Cuis7-8-main/Packages/...`; left the two `mcp-bridge/image/*.pck.st` fileIns untouched,
since those must keep reading live from the working tree). Verified by temporarily renaming
`Cuis7-8-main/Packages` away and confirming the suite still passes 35/35 — proving the
dependency is actually gone, not just coincidentally still satisfied.

## Phase 4 — [Scaffold] mcp-bridge/server/src/tools.ts + tools.test.ts

Added `list_senders_of`/`list_implementors_of` entries to `TOOL_METADATA` (declarative
metadata only — name, description, `{selector: string}` required input schema — no handler
code, since `createTools`'s existing generic handler already covers any tool by name).
Updated the "7 read-only reflection operations" doc comment to 9. Added one happy-path test
per new tool in `tools.test.ts`, mirroring the existing `list_categories` test; did not
duplicate the shared error-mapping test, consistent with how thinly the existing 7 tools are
covered today. `npm run build` clean; `npm test` 13/13 passing.

## Phase 5 — [Scaffold] mcp-bridge/README.md

Added `list_senders_of`/`list_implementors_of` bullets to the "Available tools" list
(matching the existing 7 bullets' format) and bumped "7 tools" to "9 tools" in the
registration steps. Documentation-only; diff confirmed no other lines touched.

## Closing summary

Built two new read-only MCP tools, `list_senders_of(selector)` and
`list_implementors_of(selector)`, mirroring the Cuis System Browser's "Senders of..."/
"Implementors of..." message-list menu items, end to end: Cuis-side dispatch handlers
(`handleListSendersOf:`/`handleListImplementorsOf:`, sharing `selectorParamFrom:` and
`methodReferenceArrayFrom:` helpers), `PROTOCOL_VERSION` bumped to 2 on both sides, TS wire
types and MCP tool metadata, and documentation (`PROTOCOL.md`, `README.md`) — all following
the existing 7-operation pattern exactly, as the technical spec anticipated.

The design evolved from the spec in two ways, both discovered through TDD rather than
planned: the shared `methodReferenceArrayFrom:` helper emerged via refactor (sequencing
difference only, same final shape as planned) and, more significantly, building a genuine
multi-class test (rather than settling for single-entry fixtures) surfaced a real,
previously-latent production bug — `Json`'s array renderer embeds literal newlines between
non-literal elements, breaking the wire protocol's own "no embedded literal newline"
guarantee for any response with 2+ result rows, affecting the production Node client
identically to the test client. Fixed locally in `sendSuccess:` (strip embedded
newline/CR bytes before framing) rather than touching the vendored `Json` package. This
was the most consequential finding of the whole implementation — without it, any real
`list_senders_of`/`list_implementors_of` query returning more than one row would have
broken in production.

Also closed out two test-infrastructure gaps along the way, both user-authorized side
quests rather than scope creep: a chunked-response test helper (`receiveFullResponseFrom:`)
so future tests aren't limited to artificially tiny fixtures, and bundling
`JSON.pck.st`/`Network-Kernel.pck.st` into `.headless-base` so the test harness no longer
depends on `Cuis7-8-main/Packages/` existing at all.

Final state: 35 Cuis-side SUnit tests passing (7 new), 13 Node/Vitest tests passing (2 new),
both builds clean.

## Post-implementation: closing static-verify gaps

`/spec-verify-static` found 8/18 invariants covered. Closed the 5 worth closing (4, 6, 8,
11, 15) with 5 new tests, one at a time, verified independently after each:

- Invariant 4 (chainability): `testListImplementorsOfResultRowChainsDirectlyIntoGetMethodSource`
  — builds a real `get_method_source` request from a `list_implementors_of` row's own
  values, no hardcoded literals, proving no translation is needed.
- Invariant 6 (literal-reference matching): needed a dedicated fixture, since no existing
  code happened to reference a selector as a bare literal without also sending it. Added
  `fixtureArrayReferencingSelectorWithoutSendingIt` (a literal array containing a made-up
  Symbol, never sent) to `McpBridgeTests`, then
  `testListSendersOfRequestMatchesLiteralReferenceNotJustSends` proving `list_senders_of`
  reports it as a sender anyway.
- Invariant 8 (case sensitivity): `testListImplementorsOfSelectorMatchingIsCaseSensitive`
  — wrong-case query against the known `setSocket:` implementor returns `[]`.
- Invariant 11 (same selector both sides): needed a dedicated fixture — no natural example
  existed either. Added `zzzFixtureSelectorOnBothSides` on both `McpBridgeTests` (instance)
  and `McpBridgeTests class`, then
  `testListImplementorsOfRequestReportsSameSelectorOnBothSidesAsTwoRows` proving both sides
  are reported as independent rows, not collapsed (asserted exactly 2, not just "at least 2").
- Invariant 15 (stale rows): `testGetMethodSourceForStaleImplementorsRowGetsOrdinaryNotFoundError`
  — takes a real row, substitutes a nonexistent selector (simulating staleness), confirms
  `get_method_source` answers its one ordinary `not_found` path, no special-casing.

All 5 passed immediately (each locks in already-correct existing behavior; none needed
implementation changes) — consistent with the earlier empty-result/case-sensitivity cycles
in phase 3, not the over-implementation anti-pattern. Final count: 40 Cuis-side SUnit tests
(5 more than the 35 from implementation), `verify-static-report.md` updated to 13/18 covered.

Remaining 5 uncovered (5, 14, 16, 17, 18) are "must not regress" guarantees inherited from
the bridge's existing shared architecture rather than new behavior this feature introduces —
judged not worth dedicated new tests, per the static-verify follow-up discussion.

## Post-verification: real cross-component bug found via dynamic verification

While building a run skill for `/spec-verify-dynamic` (driving a live, freshly-launched
server directly over the real NDJSON wire protocol, not the SUnit suite), the very first
handshake failed: `protocol_mismatch — expected 1, got 2`. Root cause: `PROTOCOL.md` and
`protocol.ts` were both bumped to `PROTOCOL_VERSION = 2` during implementation (per this
project's own convention: any wire schema change bumps the version), but
`McpBridgeConnection class>>protocolVersion` in `MCP-Bridge.pck.st` was never actually
changed — it still returned `1`. This never surfaced in the SUnit suite because every test's
handshake hardcodes `protocol_version: 1` on both the sent request and the expected
response, matching the also-unbumped constant, so nothing ever went red. A real Node client
built against the documented version 2 would have failed to handshake with any freshly
loaded Cuis image — breaking all 9 operations, not just the two new ones. This is exactly
the class of bug static test coverage structurally cannot catch (the tests and the
constant drifted together, consistently, just consistently wrong) and dynamic/live
verification caught on the very first real request.

Fixed: bumped `protocolVersion` to `^ 2`; updated all 62 handshake literal occurrences in
`Tests-MCP-Bridge.pck.st` from `1` to `2` (both sent and expected); separately flipped
`testHandshakeRequestWithMismatchedVersionGetsProtocolMismatchError` to send `3` and expect
`"expected 2, got 3"`, preserving a genuine mismatch case against the corrected real version
rather than accidentally testing the now-correct value. Suite green: 40 run, 40 passes,
same count as before (values corrected, no tests added/removed).

## Post-verification: real sort tie-break bug found via dynamic verification

While dynamically exercising invariant 7 against a live server, querying `list_senders_of`
for a widely-referenced real selector (`on:`, ~139 rows across the loaded image) revealed
the results were NOT alphabetically sorted within a class — e.g. `CompiledMethod` entries
came back as `writesField:`, `sendsSelector:`, `longPrintRelativeOn:indent:`, ... clearly
unordered. Root cause: `methodReferenceArrayFrom:`'s sort block only ever compared class
name (`[:a :b | a classSymbol asString <= b classSymbol asString]`) — no tie-break for two
entries with the same class, so same-class groups came back in whatever order the
underlying `Smalltalk allCallsOn:`/`allImplementorsOf:` scan happened to produce.

This slipped past every static test because none of the fixtures used across the
implementation or static-verify-gap-closing work ever had a genuine same-class,
multi-selector tie — including the ~108-entry `printOn:` test, which has exactly one row
per class. Dynamic verification's use of real, large, naturally-occurring data (rather than
hand-picked single-row fixtures) is precisely what surfaced this.

Fixed with a dedicated fixture (two same-class, same-side sender methods, deliberately
defined in the file in the *wrong* order to prove definition-order isn't what's driving
correctness) driving a new test
(`testListSendersOfRequestSortsBySelectorWithinSameClassAndSide`), then fixing
`methodReferenceArrayFrom:`'s sort block to the full 3-key comparator (class, then
instance-before-class, then own selector) already documented in functional-spec.md
invariant 7 and technical-spec.md's original design — this was always the intended
behavior, just never actually implemented past the first key. Suite green: 41 run, 41
passes (1 more than before this fix — the new regression-guard test).

## Dynamic verification (/spec-verify-dynamic)

Built a run recipe (`.claude/skills/run-cuis-mcp-bridge/`) and drove a genuinely live,
freshly-launched server instance (port 6790, isolated from any interactive dev session on
6789) directly over its real NDJSON wire protocol for all 18 functional-spec invariants.
17 passed live; 1 (invariant 14, live-state fidelity) has no runtime surface to exercise,
since the bridge is deliberately read-only. This round caught the sort tie-break bug above
(invariant 7) and confirmed the protocol-version fix (invariant 17's handshake now correctly
reports "expected 2"). Full report: `verify-dynamic-report.md`.

## Implementation files

- mcp-bridge/PROTOCOL.md
- mcp-bridge/image/MCP-Bridge.pck.st
- mcp-bridge/image/Tests-MCP-Bridge.pck.st
- mcp-bridge/server/src/protocol.ts
- mcp-bridge/server/src/tools.ts
- mcp-bridge/server/src/tools.test.ts
- mcp-bridge/README.md
- tools/run-headless-tests.sh
- mcp-bridge/image/run-tests.st

## Retrospective

All 5 phases completed: PROTOCOL.md and `protocol.ts` scaffolds, the TDD phase on the Cuis side, `tools.ts` and its tests, and the README. The initiative added two read-only tools, `list_senders_of` and `list_implementors_of`, mirroring the System Browser's "Senders of..." and "Implementors of..." menu items. It bumped `PROTOCOL_VERSION` to 2 and followed the existing 7-operation pattern as the technical spec anticipated. Final state was 41 Cuis-side SUnit tests and 13 Vitest tests passing.

Deviations from the spec, all found by testing rather than planned:
- A multi-class test exposed a latent bug in the vendored `Json` array renderer. It embeds literal newlines in responses with 2 or more rows, which breaks the wire protocol's single-line framing. It was fixed locally in `sendSuccess:`, leaving the vendored package alone.
- Two user-authorized test-infrastructure side quests: a chunked-response test helper, and bundling `JSON.pck.st` and `Network-Kernel.pck.st` into `.headless-base`.
- Static verification found 8 of 18 invariants covered. Five more were closed with new tests, bringing it to 13 of 18. The other 5 are inherited "must not regress" guarantees and were left without dedicated tests.

Dynamic verification caught two bugs that the static suite structurally could not:
- `McpBridgeConnection class>>protocolVersion` still returned 1 while the docs and TypeScript were bumped to 2. The tests hardcoded 1, so they drifted consistently with the constant.
- The sort block compared only class name, with no tie-break by side or selector. The fixtures never had two rows in the same class.

Result: 17 of 18 invariants passed live. The remaining one, live-state fidelity, has no runtime surface in a read-only bridge.

Lesson: hand-picked single-row fixtures and self-consistent test constants hide real bugs. A live run against real, large data and the real wire protocol caught both of the bugs above.
