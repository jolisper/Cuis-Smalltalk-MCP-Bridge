# Senders/Implementors Tools — Technical Spec

## Context

The bridge is two components communicating over the NDJSON protocol in `mcp-bridge/PROTOCOL.md`:
a Cuis-side package (`mcp-bridge/image/MCP-Bridge.pck.st`) and a Node/TypeScript process
(`mcp-bridge/server/src/`). Both sides already implement 7 read-only reflection operations in
an identical, repeatable shape; the two new operations (`list_senders_of`,
`list_implementors_of`, functional-spec.md invariants 1–18) are additional instances of that
same shape, not a new mechanism.

**Cuis side — `mcp-bridge/image/MCP-Bridge.pck.st`.** `McpBridgeConnection>>operationHandlers`
(lines 97–108) is a `Dictionary` mapping wire `op` strings to handler selectors, consulted by
`requestLoop` (lines 65–95) on every request line. Each handler (e.g.
`handleGetClassComment:`, lines 190–195) follows the same shape: pull params via
`paramNamed:from:` (lines 218–222), resolve/validate, and answer via `sendSuccess:`
(lines 228–236) or `sendError:message:` (lines 238–249). `resolveClassFromRequest:`
(lines 203–205) and `resolveSide:` (lines 211–216) are the existing reusable validation
helpers; there is no existing "required non-empty string param" helper — each handler either
relies on a Smalltalk-level lookup to naturally fail, or (for `list_classes`/`list_methods`)
explicitly tests membership before proceeding. `sortedStringArrayFrom:` (lines 224–226) is the
existing sort helper, but it only handles a flat collection of stringifiable items — the two
new operations need a different sort key (class, then side, then selector) over
`MethodReference` objects, so it doesn't apply as-is.

The reflection itself is already available in the base image and needs no new Cuis code
beyond the handlers: `Smalltalk allCallsOn: aSymbol` and `Smalltalk allImplementorsOf: aSymbol`
each answer a collection of `MethodReference` (category `Tools-Browser`), whose relevant
accessors are `classSymbol` (the class name Symbol), `classIsMeta` (`true` = class side), and
`selector`/`methodSymbol` (the reported method's own selector). This mapping was confirmed
live against the running image during the research phase of this initiative and is exactly
the `{class, selector, side}` shape the wire protocol already uses for `list_methods` and
`get_method_source`.

**Bridge process side — `mcp-bridge/server/src/`.** `tools.ts`'s `createTools` (lines 106–125)
is fully generic: every tool's `handler` just forwards `args` to
`client.sendRequest(meta.name, args)` (line 111) and maps a thrown error's `.code`/`.message`
into an MCP error result. Adding a tool is adding one entry to the `TOOL_METADATA` array
(lines 23–94) — no new handler code. `cuisClient.ts`'s `sendRequest<T>(op, params)` (lines
208–216) is likewise already generic over `op`; it needs no changes. `index.ts` builds its
tool list dynamically from `createTools(client)` (line 16) and has no hardcoded tool count or
list. `protocol.ts` is the one file that encodes each operation by name as TypeScript types
(`ListCategoriesParams`, etc., lines 50–93) and as a discriminated union
(`McpBridgeOperationRequest`, lines 104–111) — this is documentation/type-safety only; nothing
at runtime switches on it.

**Tests.** `Tests-MCP-Bridge.pck.st` has one `TestCase` (`McpBridgeTests`) with one test per
behavior, each opening a raw `Socket` against a fresh port, handshaking, sending one request
line, and asserting the decoded JSON response (e.g.
`testListCategoriesRequestGetsSortedCategoryList`, lines 243–267). `tools.test.ts` has one
`describe` block per exported function with a couple of `it`s using a fake `CuisClient`.
Neither test suite needs new infrastructure — just more tests in the same shape.

**Protocol version.** `McpBridgeConnection class>>protocolVersion` (image, line 51–52) and
`PROTOCOL_VERSION` (`protocol.ts` line 13) are both currently `1`. Per `PROTOCOL.md`'s own
convention (bump on any wire schema change, regardless of size), both move to `2` together.

## Proposed changes

### Cuis side

1. Two new handler methods on `McpBridgeConnection`, alongside the existing seven:
   - `handleListImplementorsOf: request` — resolve `selector` via `paramNamed:from:`; if it
     is not a non-empty `String`, answer `invalid_request` (mirroring functional-spec
     invariant 13); otherwise answer `sendSuccess:` with
     `self methodReferenceArrayFrom: (Smalltalk allImplementorsOf: selector asSymbol)`.
   - `handleListSendersOf: request` — identical shape, using `Smalltalk allCallsOn: selector
     asSymbol`.
   - Both registered in `operationHandlers` as `'list_implementors_of' ->
     #handleListImplementorsOf:` and `'list_senders_of' -> #handleListSendersOf:`.
2. A new private helper, `methodReferenceArrayFrom: aCollection`, shared by both handlers:
   sorts `aCollection` by `(classSymbol asString, classIsMeta, methodSymbol asString)` — class
   alphabetically, instance side (`classIsMeta = false`) before class side for the same class,
   then the reported method's own selector alphabetically (functional-spec invariant 7) —
   then maps each `MethodReference` to an `OrderedDictionary` with keys `'class'`
   (`classSymbol asString`), `'selector'` (`methodSymbol asString`), `'side'` (`classIsMeta
   ifTrue: ['class'] ifFalse: ['instance']`), and answers the mapped result as an `Array`.
   This is a new sort/shape helper distinct from `sortedStringArrayFrom:`, since that one
   assumes a flat list of directly-comparable strings.
3. `McpBridgeConnection class>>protocolVersion` bumps from `^1` to `^2`.
4. The `McpBridgeConnection` class comment (lines 43–44), which explicitly enumerates the
   dispatched operations, is updated to list the two new ones alongside the existing seven.

No changes to `McpBridgeServer`, `McpBridgeConnectionQueue`, connection lifecycle, or
transport — these two operations are pure additions to the existing dispatch table.

### Bridge process side

1. `protocol.ts`: bump `PROTOCOL_VERSION` to `2`; add `ListSendersOfParams`/
   `ListImplementorsOfParams` (`{ selector: string }`) and a shared `MethodReferenceEntry`
   type (`{ class: string; selector: string; side: Side }`), with
   `ListSendersOfResult`/`ListImplementorsOfResult` as `MethodReferenceEntry[]`; extend
   `McpBridgeOperationRequest` with the two new `{ op; params }` variants; update the "7
   read-only reflection operations" comment (line 103) to 9.
2. `tools.ts`: add two entries to `TOOL_METADATA` — `list_senders_of` and
   `list_implementors_of`, each `inputSchema: { type: 'object', properties: { selector: {
   type: 'string' } }, required: ['selector'] }`. No handler code — `createTools`'s existing
   generic handler (line 109–123) already covers any tool whose name matches a Cuis-side op.
   Update the "7 read-only reflection operations" comment (line 102) to 9.
3. `cuisClient.ts` and `index.ts`: no changes. Both are already generic over operation name.

### Docs

1. `mcp-bridge/PROTOCOL.md`: add `### list_senders_of` and `### list_implementors_of`
   sections in the "Operations" list, following the existing per-operation format (Params /
   Success result / Errors / example request+response JSON) — grounded in functional-spec.md
   invariants 1–13. Update "All 7 operations" and the `PROTOCOL_VERSION = 1` block to reflect
   9 operations and version 2.
2. `mcp-bridge/README.md`: add both tools to the "Available tools" list (§5) and bump "The 7
   tools listed below" (line 115) to 9.

### Tradeoff called out

The new `methodReferenceArrayFrom:` sort key is implemented explicitly (a 3-key sort block)
rather than relying on `MethodReference>>#<=`'s own ordering (traced during this initiative's
research: it sorts real methods before the synthetic `#Comment` pseudo-selector, then by
`classIsMeta`, with `classIsMeta` sorting *after* real methods within a class — i.e., not
strictly alphabetical). Since `allCallsOn:`/`allImplementorsOf:` never produce a `#Comment`
entry (confirmed during research — neither one can emit one), the two orderings would happen
to agree on real data, but writing the sort explicitly makes the actual guarantee (invariant
7's alphabetical-with-instance-before-class rule) independent of that incidental fact rather
than resting on it silently.

## Implementation sequence

1. `mcp-bridge/PROTOCOL.md` — add the two new operation sections, bump `PROTOCOL_VERSION` to 2
2. `mcp-bridge/image/MCP-Bridge.pck.st` — `methodReferenceArrayFrom:` helper, the two new
   handler methods, `operationHandlers` entries, `protocolVersion` bump, class comment update
3. `mcp-bridge/image/Tests-MCP-Bridge.pck.st` — SUnit tests for both new operations
4. `mcp-bridge/server/src/protocol.ts` — new params/result types, union variants,
   `PROTOCOL_VERSION` bump to 2
5. `mcp-bridge/server/src/tools.ts` — two new `TOOL_METADATA` entries
6. `mcp-bridge/server/src/tools.test.ts` — tests for both new tool entries
7. `mcp-bridge/README.md` — tool list and count update

## Testing and validation

**Cuis-side (`Tests-MCP-Bridge`, SUnit, run via `mcp-bridge/image/run-tests.st`):**
- Invariants 1, 3 — `testListImplementorsOfRequestGetsMethodReferenceArray`: send
  `list_implementors_of` for a selector known to be implemented within the package's own
  fixture code (e.g. `setSocket:`, implemented by `McpBridgeConnection>>setSocket:`); assert
  the result array contains `{class: 'McpBridgeConnection', selector: 'setSocket:', side:
  'instance'}`.
- Invariant 2 — `testListSendersOfRequestGetsMethodReferenceArray`: send `list_senders_of` for
  `setSocket:`; assert the result contains `{class: 'McpBridgeConnection', selector: 'on:',
  side: 'class'}` (`McpBridgeConnection class>>on: aSocket` sends `setSocket:` — confirmed by
  reading its source during Context research), and specifically assert this row's own
  `selector` is `'on:'`, not `'setSocket:'`, to pin down the sender/implementor field-meaning
  distinction directly.
- Invariant 6 — reuse the same `list_senders_of` fixture and confirm no special-casing is
  needed beyond what `allCallsOn:` already does (no dedicated test possible for "would also
  match a non-send literal reference" without adding one to the fixture; covered by
  construction since the handler adds no filtering on top of `allCallsOn:`'s result).
- Invariant 7 — assert both results' arrays equal their own `asSortedCollection:` under the
  (class, side, selector) ordering, same style as the existing
  `testListCategoriesRequestGetsSortedCategoryList` sortedness assertion.
- Invariant 12 — `testListImplementorsOfRequestForUnknownSelectorGetsEmptyArray` and the
  `list_senders_of` equivalent: send a nonsense selector string; assert `result equals: #()`,
  not an error.
- Invariant 13 — `testListImplementorsOfRequestWithMissingSelectorGetsInvalidRequestError`
  (params `{}`) and the `list_senders_of` equivalent; assert `invalid_request`.
- Invariants 14, 16, 17, 18 — no new tests; these are unchanged bridge-wide guarantees already
  covered by the existing suite (no caching layer, no write/eval path, connectivity/session
  behavior untouched by this change).

**Bridge process (`tools.test.ts`, Vitest):**
- Confirms `TOOL_METADATA` produces a `list_senders_of` and a `list_implementors_of` tool with
  the expected `inputSchema`, and that each one's generic handler forwards to
  `client.sendRequest` and maps both success and coded-error results — same two-test shape as
  the existing `list_categories`/`list_classes` tests (lines 6–43).

**End-to-end (manual):** with a real image running `McpBridgeServer startOn: 6789` and the
built bridge registered, call both new tools through Claude Code once each — one for a
selector with real implementors/senders, one for a nonsense selector — confirming the array
shape and chaining a result row into `get_method_source` with no translation (invariant 4).
