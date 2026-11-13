# cuis-image-manager — functional spec (part 03: cleanup)

## Summary

`cuisctl` is a command-line tool that makes named Cuis images ("instances") first-class:
created, started, stopped, inspected, reset and destroyed through one interface, all sharing
the one pinned VM and pristine base. Consumers are people at a terminal, a thin Claude skill
that wraps the tool, and programs (the MCP bridge's users, CI) that call it non-interactively.

Terms: the **Cuis home** is `cuisctl`'s own per-user installation of the pinned Cuis version
(VM distribution plus pristine base image), separate from the MCP bridge's installation. An **instance** is a named copy of the base
with its own image file and its own **user files** folder. The **bridge port** is the MCP
bridge's fixed port, 6789. **Save on stop** is the in-image addition that lets an instance save
itself when asked to stop.

## Assumes

- cuis-image-manager-01-core invariant 1
- cuis-image-manager-01-core invariant 4
- cuis-image-manager-01-core invariant 18
- cuis-image-manager-01-core invariant 23
- cuis-image-manager-02-lifecycle invariant 1

## Behavior

### reset

1. `reset <name>` replaces the instance's image with a fresh copy of the pristine base. The
    user files folder is left exactly as it was, file for file.
2. `reset` on a running instance (tracked or untracked) fails and says to stop it first.
3. `reset` works on an instance whose image is missing or damaged, and on one whose saved
    state makes it unable to start; it is the way to recover such an instance.
4. A `reset` that fails or is interrupted leaves either the old image or the fresh one, never
    a half-written image, and never touches user files.

### destroy

5. `destroy <name> --yes` removes the instance completely, including its user files. The name
    is then free for `create`.
6. `destroy` without `--yes` deletes nothing; it fails, says what would be deleted (the
    instance folder and its user files), and says to pass `--yes`.
7. `destroy` on a running instance (tracked or untracked) fails and says to stop it first,
    even with `--yes`.
8. `destroy` on a name that does not exist fails with a not-found error.
9. `destroy` removes nothing outside the instance's own folder.

### The skill

10. The skill exposes the same commands with the same outcomes as the tool; it adds no
    behavior of its own.
11. The skill passes `--yes` to `destroy` only after the user has explicitly confirmed the
    deletion in the conversation.

## Must not regress

- cuis-image-manager-01-core invariant 4
- cuis-image-manager-01-core invariant 5
- cuis-image-manager-01-core invariant 13
- cuis-image-manager-01-core invariant 21
- cuis-image-manager-01-core invariant 27
- cuis-image-manager-02-lifecycle invariant 10
- cuis-image-manager-02-lifecycle invariant 18
- cuis-image-manager-02-lifecycle invariant 22
