# Static verify report — cuis-image-manager-03-cleanup
Date: 2026-11-13

Invariant 1 — `reset <name>` replaces the instance's image with a fresh copy of the pristine base; user files left as they were
  Static: covered — cuisctl/src/commands/reset.test.ts:21 (base bytes restored, `snapshotTree(files/)` unchanged); also cuisctl/src/instance.test.ts:411; real Cuis: cuisctl/src/realCuis.integration.test.ts:520

Invariant 2 — `reset` on a running instance (tracked or untracked) fails and says to stop it first
  Static: covered — cuisctl/src/commands/reset.test.ts:48 (tracked and untracked: `instance_running`, hint `cuisctl stop demo`, image unchanged, VM still alive)

Invariant 3 — `reset` works on a missing or damaged image and on one that cannot start
  Static: covered — cuisctl/src/commands/reset.test.ts:226 (image deleted, changes deleted, `image/` deleted, image truncated, sources link deleted; each then starts); cuisctl/src/instance.test.ts:431; real Cuis busy-loop image: cuisctl/src/realCuis.integration.test.ts:547

Invariant 4 — a failed or interrupted `reset` leaves the old or the fresh image, never a half-written one, and never touches user files
  Static: covered — cuisctl/src/commands/reset.test.ts:192 and cuisctl/src/instance.test.ts:480 (copy fails midway: old image and changes intact, no temps, `files/` unchanged); leftover temps swept: cuisctl/src/instance.test.ts:514

Invariant 5 — `destroy <name> --yes` removes the instance completely; the name is then free for `create`
  Static: covered — cuisctl/src/commands/destroy.test.ts:20 (folder gone, `status` not_found and omits it, `create` succeeds); real Cuis: cuisctl/src/realCuis.integration.test.ts:567

Invariant 6 — `destroy` without `--yes` deletes nothing; fails, names the instance folder and user files, says to pass `--yes`
  Static: covered — cuisctl/src/commands/destroy.test.ts:50 (`confirmation_required`, both paths in message, hint, `snapshotTree(home)` unchanged); CLI level: cuisctl/src/runCli.test.ts:466

Invariant 7 — `destroy` on a running instance (tracked or untracked) fails and says to stop it first, even with `--yes`
  Static: covered — cuisctl/src/commands/destroy.test.ts:73 (tracked/untracked × with/without `--yes`); lock race: cuisctl/src/commands/destroy.test.ts:146

Invariant 8 — `destroy` on a name that does not exist fails with a not-found error
  Static: covered — cuisctl/src/commands/destroy.test.ts:225 (`nope` with and without `--yes` → not_found; `Bad_Name` → invalid_name)

Invariant 9 — `destroy` removes nothing outside the instance's own folder
  Static: covered — cuisctl/src/commands/destroy.test.ts:174 (`cuis/`, a second instance, a canary file and a symlink target outside the home unchanged; `tmp/` empty); cuisctl/src/instance.test.ts:557

Invariant 10 — the skill exposes the same commands with the same outcomes as the tool; adds no behavior of its own
  Static: no coverage found (no automated test; the skill is a prompt file, .claude/skills/cuisctl/SKILL.md. The technical spec assigns this to manual review plus /spec-verify-dynamic scenarios)

Invariant 11 — the skill passes `--yes` to `destroy` only after the user has explicitly confirmed the deletion in the conversation
  Static: no coverage found (no automated test; the single `--yes` occurrence is in the destroy protocol, .claude/skills/cuisctl/SKILL.md:49. Behavior needs /spec-verify-dynamic)

11 invariants — 9 covered, 2 uncovered
