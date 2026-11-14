---
name: run-cuisctl
description: Drive the built cuisctl CLI (create, status, start, stop, reset and destroy) against a live throwaway home, not its test suite. Use when asked to run, exercise or verify cuisctl for real, for example from /spec-verify-dynamic.
---

Drive `cuisctl/dist/cli.js` directly. All paths are relative to the repo root. Always set
`CUISCTL_HOME` to a throwaway directory so verification never touches `~/.cuisctl`,
`~/.cuis-mcp-bridge` or `Cuis7-8-main`.

## Prerequisites

- macOS (`create`, `start`, `stop`, `reset`, `destroy` fail with `unsupported_platform` elsewhere; `status` runs anywhere).
- Node >= 20.
- Network access for the first `create` (downloads the pinned Cuis archive, ~30 MB).
- Built CLI: `cd cuisctl && npm install && npm run build` (so `cuisctl/dist/cli.js` exists). Rebuild after any source change.
- For `start --bridge`: run from this checkout (it loads `mcp-bridge/image/MCP-Bridge.pck.st`) and port 6789 must be free (see below).

## Run (agent path)

```bash
export CUISCTL_HOME="$(mktemp -d)/cuisctl-home"
C="node cuisctl/dist/cli.js"
```

```bash
$C status                 # "Cuis home: missing" + "No instances." before first create; exit 0
$C create demo            # prepares the home on first use (~15 s), then "Created instance demo ..."
$C status                 # "Cuis home: ready" + "demo  stopped"
$C status demo            # "demo: stopped (Cuis <key>)" + folder/files/log lines
$C status demo --json     # {"ok":true,"command":"status","data":{...}}
```

Error paths (stdout `error: <message>` plus `hint:`, or JSON `{"ok":false,"error":{kind,...}}` with `--json`):

| Command | Kind | Exit |
|---|---|---|
| `$C create demo` (again) | `already_exists` | 1 |
| `$C status nope` | `not_found` | 1 |
| `$C create Bad_Name` | `invalid_name` | 1 |
| `$C create` / `$C bogus` / `$C status a b` | `usage` | 2 |

### Start and stop (real VMs)

`start` launches a real Cuis VM that outlives the command. Use `--headless` so no window opens
(GUI `start` opens a real window; only do it if asked). The CLI has no port flag: `--bridge`
always uses **6789**, so check it is free first and never touch a process you did not start.

```bash
lsof -nP -iTCP:6789 -sTCP:LISTEN     # must print nothing before start --bridge; if not, stop and report
$C create demo                       # if not created yet
$C start demo --headless             # "demo: running" + pid/mode headless/bridge off/save on stop; exit 0
$C start demo --headless             # "demo: already running" (same pid), exit 0
$C start demo                        # instance_running (different mode), exit 1
$C status demo                       # "demo: running (Cuis <key>)" with pid, mode, bridge, save on stop, started
$C stop demo                         # "demo: stopped, not saved", exit 0
$C stop demo                         # "demo: already stopped", exit 0

$C start demo --headless --bridge    # "demo: running", bridge: on
lsof -nP -iTCP:6789 -sTCP:LISTEN     # exactly one listener, the VM pid from status, on 127.0.0.1
$C create other && $C start other --headless --bridge   # port_in_use naming "demo", exit 1, no VM started
$C stop demo --save                  # "demo: stopped, saved", exit 0 (macOS, armed instance)
$C start demo --headless --bridge --json   # {"ok":true,"command":"start","data":{...,"alreadyRunning":false}}
$C stop demo --save --json           # {"ok":true,"command":"stop","data":{"name":"demo","outcome":"stopped","saved":true}}
```

Check the VM output and files while an instance exists:
```bash
tail -n 20 "$CUISCTL_HOME/instances/demo/vm.log"
ls "$CUISCTL_HOME/instances/demo"    # run.json (running only), start.st, ready, vm.log, image/, files/
ls "$CUISCTL_HOME/locks"             # demo.lock, bridge.lock
```

More error paths: `$C start nope` is `not_found` (1); `$C create demo --save` and
`$C stop demo --bridge` are `usage` (2); `stop --save` that did not save is `not_saved` (1) and
still leaves the instance stopped. `run.json` exists only while running.

Progress goes to stderr; stdout holds exactly one document. The CLI never prompts.

### Reset and destroy

Both need a stopped instance. `destroy` deletes the instance's user files: only ever run it on a
throwaway instance in the throwaway home.

```bash
$C create demo                       # if not created yet
$C reset demo                        # "demo: reset to the pristine base (Cuis <key>); user files kept" + folder/files/log lines; exit 0
$C reset demo --json                 # {"ok":true,"command":"reset","data":{...instance view...}}
$C start demo --headless
$C reset demo                        # instance_running, hint "cuisctl stop demo", exit 1 (VM untouched)
$C stop demo

$C destroy demo                      # exit 1, confirmation_required naming the instance and files folders, hint "cuisctl destroy demo --yes"; nothing deleted
ls "$CUISCTL_HOME/instances/demo"    # still there
$C destroy demo --yes                # "demo: destroyed (removed <folder>, including its user files)"; exit 0
$C status demo                       # not_found, exit 1
$C destroy demo --yes --json         # now not_found; on success: {"ok":true,"command":"destroy","data":{"name":"demo","removed":{"instance":...,"files":...}}}
```

Error paths: `$C reset nope` and `$C destroy nope --yes` are `not_found` (1); `$C destroy demo --headless`
and `$C reset demo --save` are `usage` (2). To see that `reset` keeps user files, put a file in
`"$CUISCTL_HOME/instances/demo/files"` before `reset`: it is still there afterwards.

## Stop / cleanup

Always stop every instance you started, then delete the throwaway directory:
```bash
for n in demo other; do $C stop "$n" 2>/dev/null; done
lsof -nP -iTCP:6789 -sTCP:LISTEN     # must be empty again (anything left is not yours: report it, do not kill it)
rm -rf "$(dirname "$CUISCTL_HOME")"
```

## Gotchas

- Never leave `CUISCTL_HOME` unset: `create` would build `~/.cuisctl`.
- `destroy --yes` deletes the instance folder including `files/`; point it only at throwaway instances. `reset` keeps `files/` but discards the image's saved state.
- `reset` never prepares a missing home (`home_not_ready`, hint `cuisctl start <name>`); run `create` first.
- A `start` that returns means the VM is still running: never leave without `stop`, or the VM and port 6789 stay taken.
- Never kill a process on 6789 by hand-guess; `cuisctl` itself refuses to touch non-instance processes.
- Plain `stop` is SIGKILL (not saved); use `stop --save` to keep state. `start` can take up to 60 s before `start_failed`.
- The unit tests (`cd cuisctl && npm test`) are a different thing; this skill drives the built CLI.
