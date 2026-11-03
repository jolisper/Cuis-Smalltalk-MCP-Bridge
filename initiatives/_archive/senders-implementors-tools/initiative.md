# Senders/Implementors Tools

## Problem

The Cuis MCP Bridge lets an AI assistant browse a running Cuis image's structure
hierarchically — categories, classes, protocols, methods, source, comments — but every one
of its tools requires already knowing where to look: a category to list classes in, a class
to list protocols in, a class + protocol to list methods in. It has no way to answer a
cross-cutting question a developer routinely asks while working in the System Browser: "who
calls this message anywhere in the system?" or "who implements this message anywhere in the
system?"

Cuis exposes exactly this through the "Senders of..." and "Implementors of..." items on the
System Browser's message-list contextual menu — a different kind of result than the bridge's
existing tools produce, because the methods found can belong to any class in the image, not
just the one currently selected. Today, an assistant using the bridge can only inspect
locations it already knows about; it cannot discover where a selector is used or defined
elsewhere, which is exactly the kind of exploration that most resembles how a human developer
actually navigates unfamiliar code inside a live Smalltalk image.

## Goals

- Let the assistant discover every method in the image that sends a given message selector
  ("Senders of..."), with the same fidelity as the System Browser's own feature.
- Let the assistant discover every method in the image that implements a given message
  selector ("Implementors of..."), with the same fidelity as the System Browser's own
  feature.
- Make results immediately usable without a separate lookup or translation step — a caller
  should be able to go from a senders/implementors result straight to inspecting any of
  those methods' source using the bridge's existing tools.
- Preserve the bridge's existing guarantees: read-only reflection only, live-image fidelity
  (no caching or stale snapshots), and structured, predictable error handling consistent with
  the rest of the tool surface.

## Non-goals

- The class-hierarchy-scoped variants Cuis also offers — "Local Senders of...", "Local
  Implementors of...", and the super/sub-class-restricted forms — are not part of this
  initiative. Same underlying idea, but a separate, later increment.
- No write or code-evaluation capability is introduced. This stays within the bridge's
  existing read-only reflection scope; no tool here can define, compile, or evaluate
  anything.
- Not attempting to expose every message-list menu item (e.g. browsing class comments by
  search string) — only the two the user asked about.

## Scope

Touches both existing bridge components: the Cuis-side package (a new pair of dispatch
operations backed by reflection Cuis already provides for exactly this purpose) and the
bridge process (two new MCP tool definitions and their corresponding protocol/client-side
plumbing). Effort is small — comparable to any single one of the existing seven tools — since
no new subsystem, transport, or session-handling work is needed; the existing
request/response envelope, error-code vocabulary, and protocol-version handshake already
cover what these two operations need. The wire schema does change, so both sides' protocol
version move together, as already established practice for this bridge.
