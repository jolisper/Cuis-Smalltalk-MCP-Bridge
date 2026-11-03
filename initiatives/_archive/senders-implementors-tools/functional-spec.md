# Senders/Implementors Tools — Functional Spec

## Summary

Adds two read-only MCP tools, `list_senders_of(selector)` and `list_implementors_of(selector)`,
letting the AI assistant (via Claude Code) discover — across every class in a running Cuis
image, not just one already-selected class — which methods send a given message selector and
which methods implement it. This mirrors the System Browser's "Senders of..." and
"Implementors of..." message-list menu items. Consumer: the same MCP tool caller as the rest
of the bridge.

## Non-goals

- The class-hierarchy-scoped variants Cuis also offers ("Local Senders of...", "Local
  Implementors of...", and forms restricted to a class's super/subclasses) are not covered
  here — a later, separate increment.
- No result-size limit or pagination: every match is returned in one response, however many
  there are, consistent with every other tool in this bridge having none.
- No new write or evaluation capability — both tools are pure reflection, like the existing
  seven.

## Behavior

### Happy path

1. `list_implementors_of(selector)` returns an array of objects, each `{class, selector,
   side}`, one per method in the image that implements `selector`. Every row's own `selector`
   field equals the queried `selector` — it names the method being reported, and that method
   *is* the implementation.
2. `list_senders_of(selector)` returns an array of objects, each `{class, selector, side}`,
   one per method in the image whose compiled body references `selector`. Each row's `selector`
   field names the *containing* method — the method that does the referencing — and is
   generally **different** from the queried `selector`. A row `{class: "OrderedCollection",
   selector: "add:", side: "instance"}` from `list_senders_of("addLast:")` means
   `OrderedCollection>>add:` contains a reference to `addLast:`, not that `add:` and
   `addLast:` are the same message.
3. `side` is `"instance"` or `"class"`, identifying which side of the class the reported
   method lives on — the same vocabulary `list_methods` and `get_method_source` already use.
4. Every row returned by either tool can be passed directly to `get_method_source(class,
   selector, side)` with no translation, using that row's own `class`/`selector`/`side` values
   (invariant 1's rows always resolve to the queried selector; invariant 2's rows resolve to
   whichever method contains the reference).
5. The two tools are independent: calling one has no bearing on, and is not required before
   calling, the other, for the same or a different selector.

### "Senders of" matches literal references, not only message sends

6. `list_senders_of(selector)` reports a method if `selector` appears anywhere among that
   method's compiled literals — including inside a nested literal array, or as a bare Symbol
   passed to something like `perform:` — not only at an actual message-send call site. This
   matches the System Browser's own "Senders of..." feature exactly (same underlying
   mechanism), so a caller may see a row for a method that references `selector` as data
   without ever actually sending it as a message. This is expected, not a bug.

### Ordering

7. Both tools return their array sorted deterministically: primarily by `class` name
   (alphabetical), then instance-side before class-side for the same class, then by the row's
   own `selector` (alphabetical) as a final tie-break. Repeated calls against an unchanged
   image produce identical output and ordering.

### Inputs and responses

8. `selector` is used as an exact, case-sensitive Symbol — `"Add:"` and `"add:"` are different
   selectors and match independently; there is no case-insensitive or fuzzy matching.
9. `selector` is not validated against any registry of "real" selectors and is not required to
   look like syntactically valid Smalltalk message-pattern syntax. Any non-empty string is
   accepted and used verbatim; a string that happens to match no method anywhere in the image
   simply produces an empty result (invariant 12), not an error.
10. A selector implemented or referenced by many methods across many classes is returned in
    full in a single response — neither tool truncates, paginates, or otherwise limits result
    size.
11. A class that both implements/references `selector` on its instance side and its class side
    appears as two independent rows — one per side — exactly as `list_methods` and
    `get_method_source` already treat instance and class as independent namespaces.

### Empty and invalid-input cases

12. A `selector` with zero implementors, or zero senders, returns an empty array `[]` — this
    is a normal result, not an error. There is no `not_found` case for either tool: unlike a
    category, class, or protocol name, a bare selector string has no independent "exists or
    doesn't" registry to check it against.
13. A missing, empty, or non-string `selector` parameter returns a structured `invalid_request`
    error, without attempting to reach the image — mirroring `get_method_source`'s existing
    rule for its own `selector` parameter.

### Live-state fidelity and read-only guarantees (must not regress)

14. Neither tool caches: if the image's state changes between two calls (a method is
    recompiled, a new implementor is added, an existing sender is removed), the next call to
    either tool reflects the new state, never a stale snapshot from an earlier call.
15. A row returned by either tool can become stale by the time it's acted on — e.g. if the
    referenced method is removed between a `list_senders_of` call and a follow-up
    `get_method_source` call on one of its rows. This is not a special case either tool
    handles itself: the follow-up call simply gets `get_method_source`'s existing `not_found`
    behavior for a class/selector/side combination that no longer resolves.
16. Neither tool can define, compile, delete, or otherwise modify anything in the image, and
    neither evaluates arbitrary code — both are pure structured reflection, like every other
    tool in this bridge.

### Bridge connectivity and concurrency

17. Connectivity and protocol-version failures (`unreachable`, `protocol_mismatch`,
    `session_busy`) behave identically to every other tool call in this bridge — these two
    tools introduce no new connectivity or session semantics.
18. Two calls to either tool, or one call to each, never interleave their responses — the
    same request/response, non-pipelined behavior that governs every other tool call in this
    bridge applies unchanged here.
