# Dynamic verify report — cuis-image-manager-02-lifecycle
Date: 2026-11-12

Recipe: `.claude/skills/run-cuisctl`. The built `cuisctl/dist/cli.js` was driven against a throwaway `CUISCTL_HOME` with real Cuis 7.8-d4f9cc1 VMs (headless) and the real MCP bridge on 127.0.0.1:6789. No test suite was run. Setup steps done outside `cuisctl` are noted where used: a custom boot script run directly on the VM binary to put user code into an image (invariants 3 and 13), a python listener standing in for a foreign process (6, 10), and a copy of the Cuis dist without `UnixOSProcessPlugin.bundle` (17).
Dependency map: all local. The first `create` downloaded the pinned Cuis archive (~30 MB, read-only). Port 6789 was occupied by an unrelated hand-started Cuis GUI image (pid 11672) when the run began; the user stopped it before the run, and nothing of that process was touched.
Feature flags: none gate this initiative.

Invariant 1 — `start <name>` starts the instance as a GUI image by default; `--headless` ...
  Dynamic: pass — `start --headless` gave "demo: running", mode headless, bridge off; `start --headless --bridge` gave bridge on with the bridge loaded. Not run: GUI mode (it opens a real window on the desktop; use `CUISCTL_REAL_GUI=1` for that).

Invariant 2 — `start` returns only once the instance is ready ...
  Dynamic: pass — start returned only after the VM held the image and (with `--bridge`) answered a handshake; a VM started from a launcher in its own process group was still running and reported `running` after SIGHUP was sent to that group.

Invariant 3 — If the instance does not become ready within a bounded time ... `start` stops the VM, reports a start-failed error with the log tail ...
  Dynamic: pass — an image saved with a priority-40 busy loop gave "did not become ready within the start timeout" plus the vm.log tail after the default 60 s, exit 1, no process left holding the image, state stopped, no run.json.

Invariant 4 — `start` on an instance that does not exist fails with a not-found error.
  Dynamic: pass — `start nope` gave `error: No instance named "nope"` with hint `cuisctl create nope`, exit 1.

Invariant 5 — `start` on an instance already running with the same mode and bridge choice succeeds as a no-op ...
  Dynamic: pass — the repeat start gave "demo: already running" with the same pid; a GUI start on the headless instance was refused with "already running (as headless, bridge off); stop it first" (no window opened); an untracked instance was refused with "already running (untracked)".

Invariant 6 — `start --bridge` first checks whether anything accepts connections on `127.0.0.1` at the bridge port ...
  Dynamic: pass — with a python server on 127.0.0.1:6789, `start --bridge` gave "Port 6789 is already in use", exit 1, no VM started; with `demo` bridged, `start other --bridge` gave `Port 6789 is already in use by instance "demo"`. Only the loopback IPv4 foreign listener was tried live.

Invariant 7 — At most one instance has the bridge on at any time ...
  Dynamic: pass — in 3 rounds of two concurrent `start --bridge` (demo and other), each round gave exactly one running instance and one `port_in_use` naming the winner, with one listener on 6789.

Invariant 8 — A bridged instance has exactly one bridge listener ...
  Dynamic: pass — after `start --bridge`, `stop --save` and `start --bridge` again, lsof showed exactly one listener right away and still one after 12 s.

Invariant 9 — An instance started without `--bridge` has no bridge listening ...
  Dynamic: pass — the image saved with a running bridge, started without `--bridge`, had 0 listeners on 6789 right after start and after 12 s.

Invariant 10 — `cuisctl` never stops, signals or otherwise touches a process that is not one of its instances' VMs ...
  Dynamic: pass — the foreign python listener was still alive after the refused `start --bridge`; no cuisctl-started process was left holding it.

Invariant 11 — `stop <name>` ends the instance's VM without saving ...
  Dynamic: pass — "demo: stopped, not saved", exit 0, VM gone, image md5 unchanged.

Invariant 12 — `stop --save <name>` asks the instance to save and quit, and waits ...
  Dynamic: pass — "demo: stopped, saved" with the image md5 changed; on a VM without the save plugin it gave "stopped, not saved: save on stop unavailable". Not exercised live: the busy-image case where the save times out (the CLI has no way to make an already-started VM busy). The open question about not cutting off a save in progress is covered only by the unit tests.

Invariant 13 — A saved instance's next `start` resumes the saved state, including any user code that was running at save time.
  Dynamic: pass — a ticker process saved in the image kept appending to `files/tick` after `start` (2 → 6 lines in 4 s) and again after `stop --save` and `start` (7 → 11).

Invariant 14 — `stop` on a stopped instance succeeds as a no-op and says it was already stopped; any stale record is cleared.
  Dynamic: pass — "demo: already stopped", exit 0, no run.json. Not exercised live: clearing a hand-made stale run.json.

Invariant 15 — `stop` also stops an instance that is running untracked.
  Dynamic: pass — with run.json deleted, status showed "running (untracked)" and `stop demo` ended the VM; no process held the image afterwards.

Invariant 16 — Stopping never touches the instance's user files ...
  Dynamic: pass — `files/` (UserChanges and contents) was identical before and after a plain stop, apart from the ticker's own `tick` file. Not exercised live: compiling a method and checking the change log.

Invariant 17 — Saving on stop is available on macOS only. Where it is unavailable ... `stop --save` reports "stopped, not saved".
  Dynamic: pass — normal VM: `save on stop: available`; VM copy without `UnixOSProcessPlugin.bundle`: `save on stop: unavailable` and `stop --save` gave "error: stopped, not saved: save on stop unavailable", exit 1, instance stopped.

Invariant 18 — Two `cuisctl` commands that change the same instance at the same time never interleave ...
  Dynamic: pass — with `locks/demo.lock` held by a live process, `stop demo` and `start demo` both gave "another cuisctl command is changing demo", exit 1, and `status demo` still ran and showed it running. Response times were not measured.

Invariant 19 — Commands on different instances proceed independently, except for the bridge port rule in invariant 7.
  Dynamic: pass — with demo's lock held, `stop other` succeeded ("already stopped", exit 0); the bridge exception was seen in invariant 7.

Invariant 20 — `cuisctl` manages the one pinned Cuis version. An instance made from a different version is reported with its version and refused by `start` and `reset` ...
  Dynamic: pass — with `cuisKey` set to 7.7-0000000, `status` showed "Cuis 7.7-0000000", `start` gave "was made with Cuis 7.7-0000000 but cuisctl manages 7.8-d4f9cc1" (exit 1, no VM), and `stop` still worked on a running mismatched instance. `reset` does not exist yet (part 03).

Invariant 21 — The MCP bridge and its tools are unchanged; a bridged instance serves the same protocol a hand-started bridge does.
  Dynamic: pass — a raw TCP client on 6789 got `{"ok": true, "result": {"protocol_version": 3}}` for a version-3 handshake and a list of categories for `list_categories`.

Invariant 22 — A stop without `--save`, a failed start and a failed `stop --save` never alter the instance's image file.
  Dynamic: pass — image md5 was unchanged after a plain stop and after the failed (stuck) start. Not checksummed live: the failed `stop --save` on the plugin-less VM.

22 invariants — 22 passed, 0 failed, 0 skipped

Cleanup: all instances stopped, port 6789 empty, no Squeak processes left, both throwaway homes removed.
