# Cuis MCP Bridge — Functional Spec

## Summary

Exposes the live structure of a running Cuis Smalltalk image — categories, classes,
protocols, methods, method source, class definitions, and class comments — to Claude Code
as a set of read-only MCP tools. Consumer: an AI coding assistant (via Claude Code) issuing
MCP tool calls; each call is served by an external bridge process that reflects into the
running image over a local socket.

## Behavior

### Tools available

- `list_categories` — returns every category currently defined in the image.
- `list_classes(category)` — returns the classes belonging to a given category.
- `list_protocols(class)` — returns the protocols defined on a class, reported separately
  for the instance side and the class side.
- `list_methods(class, protocol, side)` — returns the method selectors within a given
  class + protocol + side (`instance` or `class`).
- `get_method_source(class, selector, side)` — returns the full source text of one method.
- `get_class_definition(class)` — returns superclass name, instance variable names, class
  variable names, and category.
- `get_class_comment(class)` — returns the class comment text.

### Happy path

1. While the Cuis-side socket server is running and reachable, every MCP tool call returns
   a result reflecting the image's state at the exact moment of the call.
2. `list_categories`, `list_classes`, `list_protocols`, and `list_methods` each return their
   results in a stable, deterministic order (alphabetical by name) so repeated calls against
   an unchanged image produce identical output.
3. `get_class_definition` and `get_class_comment` return their result as soon as the class
   is resolved — no dependency on prior calls (e.g. a consumer may call
   `get_method_source` directly without having called `list_methods` first, as long as it
   supplies a valid class/selector/side).

### Inputs and responses per tool

4. `list_classes` on a category that exists but currently has zero classes returns an empty
   list — this is a valid result, not an error.
5. `list_protocols` / `list_methods` on a class that exists but currently has zero
   protocols (or a protocol with zero methods) on the requested side returns an empty list —
   not an error.
6. `get_class_comment` on a class that exists but has no comment set returns an explicit
   empty/null comment value — distinct from a "class not found" error.
7. `list_methods` and `get_method_source` treat `side: instance` and `side: class` as
   independent namespaces: a selector defined only on one side is not found when queried on
   the other.

### Not-found and invalid-input errors

8. Requesting a category, class, protocol, method selector, or side combination that does
   not exist in the image returns a structured error result with a machine-readable code
   (`not_found`) and a human-readable message naming what was not found — the tool call
   fails cleanly, it does not hang or throw an unstructured exception.
9. A request with a missing or malformed required argument (e.g. empty class name) returns
   a structured error with code `invalid_request`, without attempting to reach the image.
10. An error result never terminates the underlying socket connection — the next tool call
    on the same session proceeds normally regardless of prior errors.

### Bridge connectivity and server lifecycle

11. The Cuis-side socket server does not start automatically when the image boots — it only
    starts when the developer explicitly triggers it (e.g. evaluating a doIt or choosing a
    menu item). Before that, no port is open.
12. If the bridge process cannot reach the Cuis-side socket server (server not started,
    image not running, port closed), every MCP tool call fails with a structured error
    (code `unreachable`) rather than hanging indefinitely.
13. If the TCP connection drops mid-session (image restarted, process killed, network
    hiccup), the next tool call attempts to reconnect; if reconnection fails, it returns the
    same `unreachable` error as invariant 12.
14. On connecting, the bridge and the Cuis-side component negotiate a protocol version. If
    the bridge's expected protocol version does not match what the Cuis-side component
    reports, every tool call fails immediately with a structured error (code
    `protocol_mismatch`) naming both the expected and actual versions, instead of sending
    requests the other side cannot understand.
15. The Cuis-side socket server only binds to localhost — it is never reachable from outside
    the machine it runs on. This does not change based on configuration; it is a
    non-negotiable invariant (single local developer, no multi-user/network exposure).

### Live-state fidelity (must not regress)

16. No caching layer sits between a tool call and the image: if the image's state changes
    between two calls (e.g. a method is recompiled or a class is renamed through the System
    Browser), the next call reflects the new state, never a stale snapshot from an earlier
    call.
17. No tool in this surface can define, compile, delete, or otherwise modify anything in the
    image — every tool listed above is read-only. Introducing a write-capable tool is
    explicitly out of scope for this spec.
18. No tool exposes arbitrary code evaluation (no `doIt`-equivalent) — the only operations
    available are the structured reflection calls listed above.

### Concurrency

19. Two sequential tool calls on the same connection never interleave their responses —
    each call receives exactly one matching response before the next request is sent
    (request/response, not pipelined), so a slow reflection operation cannot cause a later
    call's result to be delivered out of order.
20. The Cuis-side socket server accepts only one active connection at a time. If a second
    connection attempt arrives while one is already open, the server rejects it with a
    structured error (e.g. code `session_busy`) identifying that a session is already active
    — it does not accept both as independent sessions and does not silently drop the
    existing one.
21. If the active connection goes silent (no requests) past an inactivity timeout — e.g.
    after an ungraceful bridge crash that never closed the TCP connection cleanly — the
    server treats the session as dead and frees it, so a subsequent connection attempt
    succeeds instead of being rejected with `session_busy` indefinitely. A clean disconnect
    frees the session immediately, without waiting for the timeout.
22. An unexpected failure while performing a reflection operation (an internal error on the
    Cuis side, not a case of "doesn't exist") is reported as a structured error with a
    distinct code (`internal_error`) and a message, separate from `not_found` and
    `invalid_request` — it never crashes the socket server or the image, and never closes
    the connection.
23. Tool calls are not cancellable once issued — every reflection operation in this surface
    is expected to complete quickly, so no cancellation mechanism is provided in this
    delivery. Introducing cancellation is explicitly out of scope.
