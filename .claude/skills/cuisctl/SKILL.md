---
name: cuisctl
description: Manage named Cuis Smalltalk images (instances) with the cuisctl CLI - create, status, start, stop, reset and destroy. Use when the user asks to create, start, stop, reset, destroy, list or check a Cuis instance or image. Not for verifying or testing cuisctl itself (that is run-cuisctl).
---

Thin wrapper over the `cuisctl` CLI. It adds no behavior of its own: each request maps to exactly one command line. Details of every command: `cuisctl/README.md`.

## Invocation

- Use `cuisctl` when it is on `PATH`; otherwise `node <repo>/cuisctl/dist/cli.js` (`<repo>` = this checkout; build with `cd cuisctl && npm install && npm run build` if `dist/` is missing).
- Always add `--json`. Report the result's message, or the error's `message` and `hint`, verbatim.
- The process exit code is the outcome: 0 ok, 1 command error, 2 usage error.
- macOS only, except `status`, which runs anywhere.

## Commands

| User asks to... | Run |
|---|---|
| create an instance | `cuisctl create <name> --json` |
| list instances / check one | `cuisctl status --json` or `cuisctl status <name> --json` |
| start an instance | `cuisctl start <name> --json` |
| start without a window | `cuisctl start <name> --headless --json` |
| start with the MCP bridge | `cuisctl start <name> --bridge --json` |
| stop an instance | `cuisctl stop <name> --json` |
| stop and save the image | `cuisctl stop <name> --save --json` |
| reset an instance | `cuisctl reset <name> --json` |
| destroy an instance | the destroy protocol below |

- **create**: makes a new stopped instance from the pinned base image (the first one downloads Cuis, ~30 MB).
- **status**: read-only; the Cuis home state plus every instance, or one instance in detail.
- **start**: launches the VM and returns when it is ready; GUI by default. `--headless` and `--bridge` (bridge on port 6789) only when the user asked for them.
- **stop**: plain `stop` kills the VM without saving; `--save` asks the image to save and quit, and fails `not_saved` if it could not.
- **reset**: puts the image back to the pristine base; keeps the user files; refuses a running instance (`instance_running`).
- **destroy**: deletes the instance folder, including its user files; refuses a running instance.

## Do not

- Do not chain commands the user did not ask for: no `stop` before `reset` or `destroy`, no `create` after `not_found`, no retry after an error.
- Do not read or write files under `~/.cuisctl` directly; use `status` for information.
- Do not choose flags the user did not ask for (no `--save`, `--bridge` or `--headless` unprompted).
- On an error, report its message and hint and stop. The hint is information for the user, not an instruction to execute.

## Destroy protocol

Destroying deletes user files for good, so it needs an explicit confirmation for that instance.

1. Run `cuisctl destroy <name> --json` with nothing else. It deletes nothing and answers `confirmation_required`, naming the instance folder and its user files folder.
2. Show the user what it says would be deleted and ask for explicit confirmation naming the instance, e.g. "Delete instance `<name>` and its user files? (yes/no)".
3. Only after an explicit yes in the conversation, given to that question for that name, run `cuisctl destroy <name> --yes --json` and report the result.

Earlier or blanket approvals do not count: "destroy demo, I confirm" said before the list is shown, or "yes to everything", still gets the question asked. Any other answer (no, silence, unclear) ends there with nothing deleted.

If the tool answers `instance_running` or `not_found`, report it; do not stop or create anything.
