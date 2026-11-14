# cuis-image-manager — functional spec (part 02: lifecycle)

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
- cuis-image-manager-01-core invariant 14
- cuis-image-manager-01-core invariant 18
- cuis-image-manager-01-core invariant 19
- cuis-image-manager-01-core invariant 22
- cuis-image-manager-01-core invariant 23

## Behavior

### start

1. `start <name>` starts the instance as a GUI image by default; `--headless` starts it with
    no window. `--bridge` also loads the MCP bridge into the image (if it is not already
    there) and serves it on the bridge port.
2. `start` returns only once the instance is ready: the image has booted, save on stop is
    armed (where available), and, with `--bridge`, the bridge answers a handshake on the
    bridge port. It then reports running. The VM keeps running after `start` returns and after
    the caller's terminal closes.
3. If the instance does not become ready within a bounded time (a stuck image, a failed
    bridge load, an image whose saved state keeps it busy), `start` stops the VM, reports a
    start-failed error that includes the end of the instance's log, and leaves the instance
    stopped.
4. `start` on an instance that does not exist fails with a not-found error.
5. `start` on an instance already running with the same mode and bridge choice succeeds as a
    no-op and says it was already running. If the running instance differs (GUI vs headless,
    bridge on vs off) or is running untracked, `start` fails and says to stop it first.

### The bridge port

6. `start --bridge` first checks whether anything accepts connections on `127.0.0.1` at the
    bridge port. If anything does, it refuses with a port-in-use error, starts no VM, and,
    when the holder is another managed instance, names it. This holds whatever kind of
    listener holds the port (loopback-only, all interfaces, IPv4 or IPv6).
7. At most one instance has the bridge on at any time. Two `start --bridge` commands racing
    for the port result in one running bridged instance and one port-in-use refusal.
8. A bridged instance has exactly one bridge listener, including when its saved image
    already had a bridge server running at save time.
9. An instance started without `--bridge` has no bridge listening once `start` reports it
    running, even if its saved image had a bridge server running at save time.
10. `cuisctl` never stops, signals or otherwise touches a process that is not one of its
    instances' VMs, including a hand-started Cuis image holding the bridge port.

### stop

11. `stop <name>` ends the instance's VM without saving. The image file is unchanged by the
    stop, so the next `start` resumes from the last save. It works even when the image is busy
    or unresponsive, and reports "stopped, not saved".
12. `stop --save <name>` asks the instance to save and quit, and waits. When the save
    happens, it reports "stopped, saved". When it does not happen within a bounded time (the
    image is too busy, or save on stop is not available), the VM is ended anyway and the
    command reports "stopped, not saved" with the reason. `stop --save` never hangs.
    **Open question:** whether the time limit must also guarantee that a save already in
    progress is never cut off (research saw saves finish within 0.35 s).
13. A saved instance's next `start` resumes the saved state, including any user code that was
    running at save time.
14. `stop` on a stopped instance succeeds as a no-op and says it was already stopped; any stale
    record is cleared.
15. `stop` also stops an instance that is running untracked.
16. Stopping never touches the instance's user files; code edits made since the last save
    remain in its code change log in the user files folder.
17. Saving on stop is available on macOS only. Where it is unavailable, the instance still runs
    normally, `status` reports it unavailable, and `stop --save` reports "stopped, not saved".

### Concurrency

18. Two `cuisctl` commands that change the same instance at the same time never interleave:
    one proceeds and the other fails at once with a busy error. `status` is never blocked.
19. Commands on different instances proceed independently, except for the bridge port rule in
    invariant 7.

### Platform and version

20. `cuisctl` manages the one pinned Cuis version. An instance made from a different version
    is reported with its version and refused by `start` and `reset` with a version-mismatch
    error.

### Must not regress

21. The MCP bridge and its tools are unchanged; a bridged instance serves the same protocol a
    hand-started bridge does.
22. A stop without `--save`, a failed start and a failed `stop --save` never alter the
    instance's image file.

## Must not regress

- cuis-image-manager-01-core invariant 4
- cuis-image-manager-01-core invariant 5
- cuis-image-manager-01-core invariant 13
- cuis-image-manager-01-core invariant 21
- cuis-image-manager-01-core invariant 27
