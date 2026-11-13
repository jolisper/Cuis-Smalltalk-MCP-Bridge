# Dynamic verify report — cuis-image-manager
Date: 2026-11-12

Invariant 1 — `cuisctl` offers `create`, `start`, `stop`, `status`, `reset` and `destroy`, each taking a
  Dynamic: fail — only create and status exist; start, stop, reset, destroy are "unknown command" (parts 02/03 not built)

Invariant 2 — By default output is readable text. With `--json`, every command prints exactly one JSON
  Dynamic: pass

Invariant 3 — Exit code 0 means the command did what was asked (including a no-op that reports why);
  Dynamic: pass

Invariant 4 — No command ever prompts. Behavior is the same with or without a terminal, so the skill, th
  Dynamic: pass

Invariant 5 — Results do not depend on the caller's working directory.
  Dynamic: pass

Invariant 6 — Instance names are lowercase letters, digits and hyphens, starting with a letter. Any othe
  Dynamic: pass — Bad/bad_x/1a/"" refused with invalid_name, nothing created; "-x" is refused as usage (exit 2) unless after "--"

Invariant 7 — Instances live under a per-user home owned by `cuisctl` (`~/.cuisctl/instances/<name>/`),
  Dynamic: pass

Invariant 8 — Each instance has its own image file, its own user files folder, and a log of its VM's
  Dynamic: skip — no runtime surface to exercise

Invariant 9 — Instances use the Cuis home's VM, shipped packages and core updates in place; they do not
  Dynamic: skip — no runtime surface to exercise

Invariant 10 — Nothing an instance does changes the Cuis home. Saving a shipped package from inside an
  Dynamic: skip — no runtime surface to exercise

Invariant 11 — A package one instance saves to its new-packages folder can be loaded by another instance.
  Dynamic: skip — no runtime surface to exercise

Invariant 12 — `cuisctl` never forces a package reload into an instance; reloading a changed package is
  Dynamic: skip — no runtime surface to exercise

Invariant 13 — `cuisctl` never reads or writes the MCP bridge's Cuis installation
  Dynamic: pass

Invariant 14 — When `create` or `start` finds the Cuis home missing or failed, it prepares it first,
  Dynamic: pass

Invariant 15 — If preparation fails, the command fails with the preparation's error kind (network,
  Dynamic: skip — no runtime surface to exercise

Invariant 16 — If the Cuis home is already being prepared by someone else, the command waits for that
  Dynamic: skip — no runtime surface to exercise

Invariant 17 — An instance whose Cuis home was deleted keeps its image and user files. Its next `start`
  Dynamic: skip — no runtime surface to exercise

Invariant 18 — An instance is always reported in exactly one of these states:
  Dynamic: skip — no runtime surface to exercise

Invariant 19 — A record of a running VM whose process is gone, or whose process id now belongs to a
  Dynamic: skip — no runtime surface to exercise

Invariant 20 — When an instance's VM exits on its own (the user quits from the GUI, or the VM crashes),
  Dynamic: skip — no runtime surface to exercise

Invariant 21 — `status` never changes anything: no process is signalled, no file is created, moved or
  Dynamic: pass

Invariant 22 — `status` for one instance also reports its paths (instance folder, user files folder,
  Dynamic: pass

Invariant 23 — `create <name>` makes a new stopped instance whose image is a fresh copy of the pristine
  Dynamic: pass

Invariant 24 — `create` with a name that already exists fails with an already-exists error and changes
  Dynamic: pass

Invariant 25 — A `create` that fails or is interrupted leaves no partial instance: the name is reported
  Dynamic: skip — no runtime surface to exercise

Invariant 26 — `start <name>` starts the instance as a GUI image by default; `--headless` starts it with
  Dynamic: skip — no runtime surface to exercise

Invariant 27 — `start` returns only once the instance is ready: the image has booted, save on stop is
  Dynamic: skip — no runtime surface to exercise

Invariant 28 — If the instance does not become ready within a bounded time (a stuck image, a failed
  Dynamic: skip — no runtime surface to exercise

Invariant 29 — `start` on an instance that does not exist fails with a not-found error.
  Dynamic: skip — no runtime surface to exercise

Invariant 30 — `start` on an instance already running with the same mode and bridge choice succeeds as a
  Dynamic: skip — no runtime surface to exercise

Invariant 31 — `start --bridge` first checks whether anything accepts connections on `127.0.0.1` at the
  Dynamic: skip — no runtime surface to exercise

Invariant 32 — At most one instance has the bridge on at any time. Two `start --bridge` commands racing
  Dynamic: skip — no runtime surface to exercise

Invariant 33 — A bridged instance has exactly one bridge listener, including when its saved image
  Dynamic: skip — no runtime surface to exercise

Invariant 34 — An instance started without `--bridge` has no bridge listening once `start` reports it
  Dynamic: skip — no runtime surface to exercise

Invariant 35 — `cuisctl` never stops, signals or otherwise touches a process that is not one of its
  Dynamic: skip — no runtime surface to exercise

Invariant 36 — `stop <name>` ends the instance's VM without saving. The image file is unchanged by the
  Dynamic: skip — no runtime surface to exercise

Invariant 37 — `stop --save <name>` asks the instance to save and quit, and waits. When the save
  Dynamic: skip — no runtime surface to exercise

Invariant 38 — A saved instance's next `start` resumes the saved state, including any user code that was
  Dynamic: skip — no runtime surface to exercise

Invariant 39 — `stop` on a stopped instance succeeds as a no-op and says it was already stopped; any stal
  Dynamic: skip — no runtime surface to exercise

Invariant 40 — `stop` also stops an instance that is running untracked.
  Dynamic: skip — no runtime surface to exercise

Invariant 41 — Stopping never touches the instance's user files; code edits made since the last save
  Dynamic: skip — no runtime surface to exercise

Invariant 42 — Saving on stop is available on macOS only. Where it is unavailable, the instance still run
  Dynamic: skip — no runtime surface to exercise

Invariant 43 — `reset <name>` replaces the instance's image with a fresh copy of the pristine base. The
  Dynamic: skip — no runtime surface to exercise

Invariant 44 — `reset` on a running instance (tracked or untracked) fails and says to stop it first.
  Dynamic: skip — no runtime surface to exercise

Invariant 45 — `reset` works on an instance whose image is missing or damaged, and on one whose saved
  Dynamic: skip — no runtime surface to exercise

Invariant 46 — A `reset` that fails or is interrupted leaves either the old image or the fresh one, never
  Dynamic: skip — no runtime surface to exercise

Invariant 47 — `destroy <name> --yes` removes the instance completely, including its user files. The name
  Dynamic: skip — no runtime surface to exercise

Invariant 48 — `destroy` without `--yes` deletes nothing; it fails, says what would be deleted (the
  Dynamic: skip — no runtime surface to exercise

Invariant 49 — `destroy` on a running instance (tracked or untracked) fails and says to stop it first,
  Dynamic: skip — no runtime surface to exercise

Invariant 50 — `destroy` on a name that does not exist fails with a not-found error.
  Dynamic: skip — no runtime surface to exercise

Invariant 51 — `destroy` removes nothing outside the instance's own folder.
  Dynamic: skip — no runtime surface to exercise

Invariant 52 — Two `cuisctl` commands that change the same instance at the same time never interleave:
  Dynamic: skip — no runtime surface to exercise

Invariant 53 — Commands on different instances proceed independently, except for the bridge port rule in
  Dynamic: skip — no runtime surface to exercise

Invariant 54 — The skill exposes the same commands with the same outcomes as the tool; it adds no
  Dynamic: skip — no runtime surface to exercise

Invariant 55 — The skill passes `--yes` to `destroy` only after the user has explicitly confirmed the
  Dynamic: skip — no runtime surface to exercise

Invariant 56 — `cuisctl` manages the one pinned Cuis version. An instance made from a different version
  Dynamic: skip — no runtime surface to exercise

Invariant 57 — On a platform other than macOS, every command except `status` fails with an
  Dynamic: skip — no runtime surface to exercise

Invariant 58 — The MCP bridge and its tools are unchanged; a bridged instance serves the same protocol a
  Dynamic: skip — no runtime surface to exercise

Invariant 59 — The MCP bridge's own Cuis installation and its status and preparation behave exactly as
  Dynamic: skip — no runtime surface to exercise

Invariant 60 — A stop without `--save`, a failed start and a failed `stop --save` never alter the
  Dynamic: skip — no runtime surface to exercise

60 invariants — 12 passed, 1 failed, 47 skipped
