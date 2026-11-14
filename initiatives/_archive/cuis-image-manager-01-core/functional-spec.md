# cuis-image-manager — functional spec (part 01: core)

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

### Platform and version

26. On a platform other than macOS, every command except `status` fails with an
    unsupported-platform error before starting any process or download.
    **Open question:** the initiative's non-goal limits only save on stop to macOS, but the
    Cuis home itself is macOS-only today; confirm that the whole tool is macOS-only for now.

### Must not regress

27. The MCP bridge's own Cuis installation and its status and preparation behave exactly as
    before, and the Cuis home's base image and distribution are never modified by `cuisctl` or
    by any instance.
