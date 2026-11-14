# Dynamic verify report — cuis-image-manager-03-cleanup
Date: 2026-11-13

Run recipe: .claude/skills/run-cuisctl/SKILL.md (built `cuisctl/dist/cli.js`, throwaway `CUISCTL_HOME`, real headless Cuis VMs, pinned Cuis downloaded once from github.com). Feature flags: none. Port 6789 unused. `~/.cuisctl` never touched; throwaway home removed afterwards.

Invariant 1 — `reset <name>` replaces the instance's image with a fresh copy of the pristine base; user files left as they were
  Dynamic: pass — after a real `start` + `stop --save` the image differed from base; `reset` made image and changes byte-identical to base and the sources link points at the base; user files (nested folder, file, symlink) intact, including UserChanges written by the VM run

Invariant 2 — `reset` on a running instance (tracked or untracked) fails and says to stop it first
  Dynamic: pass — tracked and untracked (run.json removed, status "running (untracked)") both exit 1 `instance_running`, hint `cuisctl stop demo`; image hash unchanged; the VM pid stayed alive

Invariant 3 — `reset` works on an instance whose image is missing or damaged, and on one that cannot start
  Dynamic: pass — image deleted, changes deleted, `image/` deleted, image truncated to 10 bytes, sources link deleted: each reset restored an exact copy of base; a truncated image gave `start_failed`, then `reset` + `start --headless` reached running

Invariant 4 — a `reset` that fails or is interrupted leaves either the old image or the fresh one, never a half-written image, and never touches user files
  Dynamic: pass — 24 real `reset` runs killed with SIGKILL at 40–250 ms: image and changes were always exactly the old or exactly the base (never a third state; both outcomes seen); a following `reset` left only image/changes/sources and base bytes. User files not inspected per kill (checked in invariant 1)

Invariant 5 — `destroy <name> --yes` removes the instance completely; the name is then free for `create`
  Dynamic: pass — `instances/demo` gone, `status demo` → not_found, listing omitted it, `create demo` succeeded

Invariant 6 — `destroy` without `--yes` deletes nothing; fails, says what would be deleted, and says to pass `--yes`
  Dynamic: pass — exit 1 `confirmation_required` (text and `--json`), message names the instance folder and its files folder, hint `cuisctl destroy demo --yes`; snapshot of the whole home (444 entries, sizes and SHA-256) identical before and after

Invariant 7 — `destroy` on a running instance (tracked or untracked) fails and says to stop it first, even with `--yes`
  Dynamic: pass — tracked and untracked, with and without `--yes`: `instance_running` exit 1, instance folder kept, VM still alive

Invariant 8 — `destroy` on a name that does not exist fails with a not-found error
  Dynamic: pass — `destroy nope` and `destroy nope --yes` (text and `--json`) → `not_found` exit 1; `Bad_Name` → invalid name, exit 1

Invariant 9 — `destroy` removes nothing outside the instance's own folder
  Dynamic: pass — with a second instance, a canary in the home and `files/outlink` → a folder outside the home: `cuis/` (342 entries), the other instance and the outside folder were identical by snapshot; canary intact; `tmp/` empty

Invariant 10 — the skill exposes the same commands with the same outcomes as the tool; adds no behavior of its own
  Dynamic: pass — followed SKILL.md as written (`--json` always, one command per request, no chaining): start/stop mapped to one command each; `reset` on a running instance reported the tool's `instance_running` error and did not stop it; `start ghost` reported `not_found` and did not create. Caveat: the skill is instructions for the model, so this is the model following it, not an independent harness

Invariant 11 — the skill passes `--yes` to `destroy` only after the user has explicitly confirmed the deletion in the conversation
  Dynamic: pass — `destroy other --json` ran first without `--yes` (nothing deleted); the paths were shown and the question asked; `--yes` was passed only after the user's explicit "yes". Not exercised: the "no" answer, and a confirmation given before the list was shown

11 invariants — 11 passed, 0 failed, 0 skipped
