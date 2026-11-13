# cuis-image-manager — functional spec

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

## Behavior

### Commands and output

1. `cuisctl` offers `create`, `start`, `stop`, `status`, `reset` and `destroy`, each taking an
   instance name, plus `status` with no name, which lists every instance.
2. By default output is readable text. With `--json`, every command prints exactly one JSON
   document on standard output, holding either the result or an error with a stable error
   kind and a message. Text and JSON modes give the same outcome and the same exit code.
3. Exit code 0 means the command did what was asked (including a no-op that reports why);
   any failure exits non-zero. Every error names what failed and, where one exists, the
   command that resolves it.
4. No command ever prompts. Behavior is the same with or without a terminal, so the skill, the
   MCP server and CI see exactly what a person sees.
5. Results do not depend on the caller's working directory.
6. Instance names are lowercase letters, digits and hyphens, starting with a letter. Any other
   name is refused with an invalid-name error before anything is touched.

### Location and layout

7. Instances live under a per-user home owned by `cuisctl` (`~/.cuisctl/instances/<name>/`),
   independent of this repository and of where the tool is installed. Instances sit side by
   side in that one folder.
8. Each instance has its own image file, its own user files folder, and a log of its VM's
   output. Everything Cuis writes on the user's behalf (code change log, change sets, file-outs,
   logs, new packages) lands in the instance's user files folder.
9. Instances use the Cuis home's VM, shipped packages and core updates in place; they do not
   copy them. A GUI instance starts without the "Could not find a CoreUpdates folder" dialog,
   and packages that require shipped packages (such as the bridge) load.
10. Nothing an instance does changes the Cuis home. Saving a shipped package from inside an
    instance writes the instance's own copy of that package and leaves the shared file
    unchanged; other instances keep loading the shared version.
11. A package one instance saves to its new-packages folder can be loaded by another instance.
    When several instances hold a package of the same name, which copy loads is not defined.
12. `cuisctl` never forces a package reload into an instance; reloading a changed package is
    left to the user inside the image.
13. `cuisctl` never reads or writes the MCP bridge's Cuis installation
    (`~/.cuis-mcp-bridge/`) or this repository's checkout-local Cuis (`Cuis7-8-main/`), and
    never changes the Cuis home's base image or distribution.

### Cuis home availability

14. When `create` or `start` finds the Cuis home missing or failed, it prepares it first,
    reporting that it is doing so, waits for it, then continues. This is the only time
    `cuisctl` uses the network.
15. If preparation fails, the command fails with the preparation's error kind (network,
    checksum, write failure, base build) and changes no instance.
16. If the Cuis home is already being prepared by someone else, the command waits for that
    preparation rather than starting a second one.
17. An instance whose Cuis home was deleted keeps its image and user files. Its next `start`
    prepares the home again and the instance then runs as before.

### Instance states

18. An instance is always reported in exactly one of these states:
    - **stopped** — no VM is running for it;
    - **running** — its VM is up and ready, started by `cuisctl`; reported with its mode (GUI or
      headless), whether the bridge is on, its process id, when it started, and whether save on
      stop is available;
    - **running (untracked)** — a VM is running this instance's image but `cuisctl` did not
      start it, or lost its record (for example after a crash of `cuisctl`).
19. A record of a running VM whose process is gone, or whose process id now belongs to a
    different program, is stale. Stale records are never reported as running; the instance is
    reported stopped, and stale records never block any command.
20. When an instance's VM exits on its own (the user quits from the GUI, or the VM crashes),
    the instance is reported stopped from then on, and `start` works normally.
21. `status` never changes anything: no process is signalled, no file is created, moved or
    deleted.
22. `status` for one instance also reports its paths (instance folder, user files folder,
    log) and the Cuis version it was made from. `status` with no name lists every instance
    with its state; with no instances it reports an empty list and exits 0.

### create

23. `create <name>` makes a new stopped instance whose image is a fresh copy of the pristine
    base and whose user files folder is empty. It does not start it.
24. `create` with a name that already exists fails with an already-exists error and changes
    nothing about the existing instance.
25. A `create` that fails or is interrupted leaves no partial instance: the name is reported
    as not existing and can be created again.

### start

26. `start <name>` starts the instance as a GUI image by default; `--headless` starts it with
    no window. `--bridge` also loads the MCP bridge into the image (if it is not already
    there) and serves it on the bridge port.
27. `start` returns only once the instance is ready: the image has booted, save on stop is
    armed (where available), and, with `--bridge`, the bridge answers a handshake on the
    bridge port. It then reports running. The VM keeps running after `start` returns and after
    the caller's terminal closes.
28. If the instance does not become ready within a bounded time (a stuck image, a failed
    bridge load, an image whose saved state keeps it busy), `start` stops the VM, reports a
    start-failed error that includes the end of the instance's log, and leaves the instance
    stopped.
29. `start` on an instance that does not exist fails with a not-found error.
30. `start` on an instance already running with the same mode and bridge choice succeeds as a
    no-op and says it was already running. If the running instance differs (GUI vs headless,
    bridge on vs off) or is running untracked, `start` fails and says to stop it first.

### The bridge port

31. `start --bridge` first checks whether anything accepts connections on `127.0.0.1` at the
    bridge port. If anything does, it refuses with a port-in-use error, starts no VM, and,
    when the holder is another managed instance, names it. This holds whatever kind of
    listener holds the port (loopback-only, all interfaces, IPv4 or IPv6).
32. At most one instance has the bridge on at any time. Two `start --bridge` commands racing
    for the port result in one running bridged instance and one port-in-use refusal.
33. A bridged instance has exactly one bridge listener, including when its saved image
    already had a bridge server running at save time.
34. An instance started without `--bridge` has no bridge listening once `start` reports it
    running, even if its saved image had a bridge server running at save time.
35. `cuisctl` never stops, signals or otherwise touches a process that is not one of its
    instances' VMs, including a hand-started Cuis image holding the bridge port.

### stop

36. `stop <name>` ends the instance's VM without saving. The image file is unchanged by the
    stop, so the next `start` resumes from the last save. It works even when the image is busy
    or unresponsive, and reports "stopped, not saved".
37. `stop --save <name>` asks the instance to save and quit, and waits. When the save
    happens, it reports "stopped, saved". When it does not happen within a bounded time (the
    image is too busy, or save on stop is not available), the VM is ended anyway and the
    command reports "stopped, not saved" with the reason. `stop --save` never hangs.
    **Open question:** whether the time limit must also guarantee that a save already in
    progress is never cut off (research saw saves finish within 0.35 s).
38. A saved instance's next `start` resumes the saved state, including any user code that was
    running at save time.
39. `stop` on a stopped instance succeeds as a no-op and says it was already stopped; any stale
    record is cleared.
40. `stop` also stops an instance that is running untracked.
41. Stopping never touches the instance's user files; code edits made since the last save
    remain in its code change log in the user files folder.
42. Saving on stop is available on macOS only. Where it is unavailable, the instance still runs
    normally, `status` reports it unavailable, and `stop --save` reports "stopped, not saved".

### reset

43. `reset <name>` replaces the instance's image with a fresh copy of the pristine base. The
    user files folder is left exactly as it was, file for file.
44. `reset` on a running instance (tracked or untracked) fails and says to stop it first.
45. `reset` works on an instance whose image is missing or damaged, and on one whose saved
    state makes it unable to start; it is the way to recover such an instance.
46. A `reset` that fails or is interrupted leaves either the old image or the fresh one, never
    a half-written image, and never touches user files.

### destroy

47. `destroy <name> --yes` removes the instance completely, including its user files. The name
    is then free for `create`.
48. `destroy` without `--yes` deletes nothing; it fails, says what would be deleted (the
    instance folder and its user files), and says to pass `--yes`.
49. `destroy` on a running instance (tracked or untracked) fails and says to stop it first,
    even with `--yes`.
50. `destroy` on a name that does not exist fails with a not-found error.
51. `destroy` removes nothing outside the instance's own folder.

### Concurrency

52. Two `cuisctl` commands that change the same instance at the same time never interleave:
    one proceeds and the other fails at once with a busy error. `status` is never blocked.
53. Commands on different instances proceed independently, except for the bridge port rule in
    invariant 32.

### The skill

54. The skill exposes the same commands with the same outcomes as the tool; it adds no
    behavior of its own.
55. The skill passes `--yes` to `destroy` only after the user has explicitly confirmed the
    deletion in the conversation.

### Platform and version

56. `cuisctl` manages the one pinned Cuis version. An instance made from a different version
    is reported with its version and refused by `start` and `reset` with a version-mismatch
    error.
57. On a platform other than macOS, every command except `status` fails with an
    unsupported-platform error before starting any process or download.
    **Open question:** the initiative's non-goal limits only save on stop to macOS, but the
    Cuis home itself is macOS-only today; confirm that the whole tool is macOS-only for now.

### Must not regress

58. The MCP bridge and its tools are unchanged; a bridged instance serves the same protocol a
    hand-started bridge does.
59. The MCP bridge's own Cuis installation and its status and preparation behave exactly as
    before, and the Cuis home's base image and distribution are never modified by `cuisctl` or
    by any instance.
60. A stop without `--save`, a failed start and a failed `stop --save` never alter the
    instance's image file.
