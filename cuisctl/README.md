# cuisctl

Command-line manager for named Cuis images ("instances"). Every instance is its own Cuis image
with its own `CoreUpdates`, `Packages/` and `files/` folders, while all instances share one pinned
Cuis VM/distribution and one pristine base image, downloaded once.

`cuisctl` is independent from the MCP bridge: it has its own pinned Cuis and its own home,
`~/.cuisctl`, and never touches `~/.cuis-mcp-bridge`.

Commands: `create`, `status`, `start`, `stop`, `reset`, `destroy` and `run`. A thin Claude skill that wraps them lives in `.claude/skills/cuisctl/SKILL.md`.

## Requirements

- macOS (`create`, `start`, `stop`, `reset`, `destroy` and `run` fail with `unsupported_platform` elsewhere; `status` runs on any platform)
- Node >= 20
- No runtime dependencies

## Build and run

```
npm install
npm run build
node dist/cli.js <command> ...     # or: npm link   (then use `cuisctl`)
```

## Commands

```
cuisctl create <name> [--json]
cuisctl status [<name>] [--json]
cuisctl start <name> [--headless] [--bridge] [--json]
cuisctl stop <name> [--save] [--json]
cuisctl reset <name> [--json]
cuisctl destroy <name> [--yes] [--json]
cuisctl run <name> <code> [--headless | --gui] [--save | --detach] [--timeout <seconds>] [--json]
cuisctl run <name> --file <path> [options]
cuisctl run <name> --stdin [options]
```

Each command accepts only its own flags; any other flag (for example `create --save`) is a `usage` error.

`create <name>` makes a new stopped instance from the pinned base image.

```
$ cuisctl create demo
Created instance demo (Cuis 7.8-d4f9cc1)
  state:  stopped
  folder: /Users/me/.cuisctl/instances/demo
  files:  /Users/me/.cuisctl/instances/demo/files
  log:    /Users/me/.cuisctl/instances/demo/vm.log
```

`status` lists every instance with the state of the Cuis home; `status <name>` shows one instance.
It is strictly read-only.

```
$ cuisctl status
Cuis home: ready
demo   stopped
other  running (pid 4242)
```

States of the home: `missing`, `ready`, `preparing`, `failed` (shown with the recorded error).
With no instances it prints `No instances.`. `status demo` prints
`<name>: <state> (Cuis <key>)`, then the runtime lines that are known (in this order: `pid`,
`mode`, `bridge`, `save on stop`, `started`), then the `folder`, `files` and `log` lines:

```
$ cuisctl status demo
demo: stopped (Cuis 7.8-d4f9cc1)
  folder: /Users/me/.cuisctl/instances/demo
  files:  /Users/me/.cuisctl/instances/demo/files
  log:    /Users/me/.cuisctl/instances/demo/vm.log
```

A running instance adds, for example, `  pid:    4242`, `  mode:   headless`, `  bridge: on`,
`  save on stop: available` and `  started: <timestamp>`. The state is `stopped`, `running` or
`running (untracked)`.

### start

`start <name>` launches the instance's VM and returns once it is ready.

- **GUI by default**: the image opens its window. `--headless` starts it with no window.
- **`--bridge`** also loads the MCP bridge into the image (only if it is not already there) and
  serves it on port **6789**, the bridge's fixed port. There is no port flag. Without `--bridge`
  the instance has no bridge listening, even if its saved image had one running.
- **Ready** means the image has booted, save on stop is armed (where available) and, with
  `--bridge`, the bridge answers a handshake on `127.0.0.1:6789` with exactly one listener, on
  loopback only. The VM keeps running after `start` returns and after the terminal closes.
- **`start_failed`**: if the instance is not ready within 60 s (stuck image, failed bridge load,
  saved state that keeps it busy, VM exiting early), `start` kills the VM, reports the last 20
  lines of `vm.log` in the error and leaves the instance stopped. The image file is not changed.
- **Already running** with the same mode and bridge choice: a no-op that succeeds with
  `alreadyRunning: true` (the same pid is kept).
- **`instance_running`**: running with a different mode or bridge choice, or running untracked.
  Stop it first (`hint: cuisctl stop <name>`).
- **`port_in_use`**: with `--bridge`, if anything accepts connections on `127.0.0.1:6789` (any
  kind of listener), no VM is started. When the holder is another instance, the message names
  it. Two racing `start --bridge` commands give one running instance and one `port_in_use`.
- **`version_mismatch`**: an instance made from a different Cuis version than the pinned one is
  refused (`status` still reports it, `stop` still works).
- `start` also prepares the Cuis home first if needed, like `create`. `--bridge` needs the
  repo checkout (it loads `mcp-bridge/image/MCP-Bridge.pck.st`).

```
$ cuisctl start demo --headless --bridge
demo: running
  pid:    4242
  mode:   headless
  bridge: on
  save on stop: available
  started: 2026-01-01T12:00:00.000Z
  folder: /Users/me/.cuisctl/instances/demo
  files:  /Users/me/.cuisctl/instances/demo/files
  log:    /Users/me/.cuisctl/instances/demo/vm.log

$ cuisctl start demo --headless --bridge
demo: already running
  ...

$ cuisctl start other --bridge
error: Port 6789 is already in use by instance "demo"
```

`--json` data is the instance data (see below) plus `alreadyRunning`:

```
$ cuisctl start demo --headless --json
{"ok":true,"command":"start","data":{"name":"demo",...,"state":"running","pid":4242,"mode":"headless","bridge":false,"saveOnStop":true,"startedAt":"...","paths":{...},"alreadyRunning":false}}
```

### stop

`stop <name>` ends the instance's VM.

- **Plain `stop`** sends SIGKILL and does not save. It works even when the image is busy or
  unresponsive; the image file is unchanged, so the next `start` resumes from the last save.
  Output: `<name>: stopped, not saved`.
- **`stop --save`** asks the image to save and quit (SIGTERM) and waits up to 10 s. While the
  image file is still changing the wait extends, up to a hard cap of 60 s, so a save in progress
  is not cut off. On success: `<name>: stopped, saved`. If the image did not save (too busy,
  or save on stop unavailable) the VM is ended anyway and the command fails with `not_saved`
  and exit code 1; the message still says the instance is stopped. It never hangs.
- **Save on stop** is macOS-only and needs the `UnixOSProcessPlugin`. Where it is unavailable the
  instance runs normally, `status` shows `save on stop: unavailable` and `stop --save` ends with
  `not_saved` ("save on stop unavailable") without sending SIGTERM.
- Stopping a **stopped** instance is a no-op (`<name>: already stopped`); a stale `run.json` is
  removed.
- An instance running **untracked** is stopped too, but only when the process holding its image
  is a Squeak VM; anything else is refused with `instance_running` and left alone. `cuisctl`
  never signals a process that is not one of its instances' VMs, including a hand-started image
  holding port 6789.
- Stopping never touches the instance's `files/` folder.

```
$ cuisctl stop demo
demo: stopped, not saved

$ cuisctl stop demo --save
demo: stopped, saved

$ cuisctl stop demo --save --json
{"ok":true,"command":"stop","data":{"name":"demo","outcome":"stopped","saved":true}}

$ cuisctl stop demo --save --json
{"ok":false,"error":{"kind":"not_saved","message":"stopped, not saved: the image did not save within 10 s"}}
```

`stop` data is `{name, outcome: "stopped" | "already_stopped", saved}`.

### reset

`reset <name>` returns a stopped instance to the pristine base.

- Replaces the instance's image and changes with fresh copies of the pristine base and re-points
  the sources link at the base. It is atomic: the copies are made as temp files next to the image
  and renamed over it, so the image is always a complete old or complete fresh one; a failed copy
  leaves the instance as it was and no temp files. Temp files left by an interrupted reset are
  removed by the next one.
- Keeps `files/` (and `Packages/`, `CoreUpdates`, `vm.log`) untouched.
- Refuses a running instance, tracked or untracked, with `instance_running`
  (`hint: cuisctl stop <name>`); nothing is signalled.
- Works on a missing or damaged image (including a missing `image/` folder) and on one that
  cannot start, which makes it the recovery for a saved image that keeps `start` failing.
- Never prepares a missing Cuis home: without a ready one it fails `home_not_ready`
  (`hint: cuisctl start <name>`). `version_mismatch` applies.

```
$ cuisctl reset demo
demo: reset to the pristine base (Cuis 7.8-d4f9cc1); user files kept
  folder: /Users/me/.cuisctl/instances/demo
  files:  /Users/me/.cuisctl/instances/demo/files
  log:    /Users/me/.cuisctl/instances/demo/vm.log
```

`reset` data is the instance data (see below).

### destroy

`destroy <name> [--yes]` deletes an instance for good.

- **Without `--yes`** it deletes nothing and fails `confirmation_required`, naming the instance
  folder and its `files/` folder (`hint: cuisctl destroy <name> --yes`).
- **With `--yes`** it removes the instance folder, **including the user files in `files/`**, and
  nothing outside it. Symlinks inside the folder are unlinked, never followed, so the shared
  Cuis distribution and anything a user linked from `files/` stay as they are. The name is free
  for `create` afterwards.
- Refuses a running instance, tracked or untracked, with `instance_running` even with `--yes`.
- No version check: an instance made from a different Cuis version stays removable.

```
$ cuisctl destroy demo
error: destroy would delete /Users/me/.cuisctl/instances/demo, including its user files in /Users/me/.cuisctl/instances/demo/files
hint: cuisctl destroy demo --yes

$ cuisctl destroy demo --yes
demo: destroyed (removed /Users/me/.cuisctl/instances/demo, including its user files)

$ cuisctl destroy demo --yes --json
{"ok":true,"command":"destroy","data":{"name":"demo","removed":{"instance":"...","files":"..."}}}
```

`destroy` data is `{name, removed: {instance, files}}`.

### run

`run <name> <code>` boots a **stopped** instance, evaluates one piece of Smalltalk code in its image,
reports the outcome and, by default, throws every change away.

```
cuisctl run demo '3 + 4'
cuisctl run demo --file script.st
echo 'Smalltalk version' | cuisctl run demo --stdin
cuisctl run demo -- '-1 abs'          # code starting with "-" needs --, --file or --stdin
```

- **Exactly one code source**: the `<code>` argument, `--file <path>` or `--stdin`. None, or more
  than one, is a `usage` error. Code that starts with `-` must follow `--` (or use `--file` /
  `--stdin`), otherwise it is read as an option. Blank code is a `usage` error.
- **`--stdin`** reads all of standard input; it needs piped input. From a terminal it fails with
  `usage` (it never prompts). `--file` that cannot be read is a `usage` error.
- **Evaluation**: the code is a Smalltalk script (statements, temporaries and several
  expressions are fine) evaluated in the instance's own image, so classes and methods of that
  image are visible. The result is the value of the last expression, shown as its `printString`;
  `nil` when the code gives no value. A syntax error fails the run with `error: syntax error`; an
  error or unhandled exception fails it with the exception's message text.
- **Options**:
  - `--headless` (the default) or `--gui`. Unlike `start`, `run` has **no window by default**;
    `--gui` opens the window. They are mutually exclusive.
  - `--timeout <seconds>`: a whole number from 1 to 300, default **60**. It limits only the
    code, not the boot. Anything else is a `usage` error.
  - `--save`: persist the changes (below). `--detach`: leave the VM running (below).
    They are mutually exclusive.
  - `--json`: one JSON document instead of text.
- **Disposable by default**: before booting, `run` backs up the image and its changes. After the
  run the VM is killed and the image and changes are restored **byte for byte**, whatever the
  outcome, so nothing the code did to the image survives. This covers only the image: the code
  is not sandboxed, and files it writes (for example into `files/`), network calls and other
  effects on the machine stay.
- **`--save`**: after a **passed** run the VM is stopped with save on stop (SIGTERM), so the
  changes persist (`saved: true`). If the image did not save (or save on stop is unavailable) the
  run fails with `not_saved` (exit 1) but its document is still reported, and the instance is
  stopped. A failed or timed out run is never saved; the image is restored.
- **`--detach`**: after the code finished (passed or failed) the VM is left running with the
  changed image and nothing is restored (`detached: true`); the instance then shows as `running`
  in `status` and `stop` ends it. A run that timed out, was interrupted or whose VM ended is
  always killed and restored.
- **Outcome**: a `status` of `passed`, `failed` or `timed_out`, and these fields:
  - `output`: what the code wrote to the Transcript, without the Transcript line prefixes. It is
    capped at 64 KB: when longer, the first 16 KB and the last 48 KB are kept and
    `outputTruncated` is true. `outputBytes` is the size of the **raw** log range of the run, which
    includes the Transcript line prefixes (a timestamp and process ids on every line), so it is
    larger than the visible text.
  - `result`: the `printString` of the last expression, capped at 4 KB (`resultTruncated`). Absent
    when the run did not pass.
  - `elapsedMs`: time spent running the code only, not the boot or the restore.
  - `saved`, `detached`: see `--save` and `--detach`.
  - `error`: the failure message, when the run did not pass.
- **Failures are reported with their document**: `failed` is `run_failed` and `timed_out` is
  `run_timed_out`, both exit 1. The text and the JSON document are the same as for a pass.
- **Lock**: `run` holds the per-instance lock for the whole run (boot, code and restore), so a
  concurrent `start`, `stop`, `reset`, `destroy --yes` or `run` on that instance fails with `busy`.
- **`instance_running`**: `run` on an instance that is running (tracked or untracked) is refused;
  stop it first (`hint: cuisctl stop <name>`).
- **`start_failed`**: if the VM is not ready within 60 s it is killed, the image is restored and the
  error carries the end of `vm.log`. `run` never loads the bridge.
- **Interruption**: Ctrl-C (SIGINT) or SIGTERM kills the VM, restores the image and exits 1 with
  an `interrupted` error (and, when the code had started, its document).
- Like `start`, `run` prepares the Cuis home first if needed. `version_mismatch` applies.

```
$ cuisctl run demo "Transcript show: 'hi'; newLine. 3 + 4"
demo: passed (12 ms)
  saved: no
output:
hi
result: 7

$ cuisctl run demo '1/0'
demo: failed (3 ms)
  saved: no
error: <exception message>

$ cuisctl run demo '3 + 4' --json
{"ok":true,"command":"run","data":{"name":"demo","status":"passed","elapsedMs":12,"output":"","outputBytes":0,"outputTruncated":false,"result":"7","resultTruncated":false,"saved":false,"detached":false}}

$ cuisctl run demo '1/0' --json
{"ok":false,"command":"run","error":{"kind":"run_failed","message":"<exception message>"},"data":{"name":"demo","status":"failed",...,"error":"<exception message>","saved":false,"detached":false}}
```

The text form is `<name>: <status> (<elapsed> ms)`, `  saved: yes|no`, `  detached: yes` (only
when detached), an `output:` block (omitted when empty, followed by
`[output truncated: <n> bytes in total]` when cut) and `result: <value>` (plus ` [truncated]`) or
`error: <message>`. The `--json` document is `{ok, command: "run", data}`; on a failure it also has
`error: {kind, message}` and `data` is still present. `data` is
`{name, status, elapsedMs, output, outputBytes, outputTruncated, result?, resultTruncated, error?, saved, detached}`.

### Concurrency

Commands that change one instance (`start`, `stop`, `reset`, `destroy --yes`, `run`) take a per-instance lock
(`locks/<name>.lock`). If another `cuisctl` command holds it, the second fails at once with
`busy` instead of waiting (`run` holds it for the whole run). `status` and `destroy` without `--yes` never take it. Different instances proceed independently,
except that at most one instance can have the bridge on.

### Instance names

A lowercase letter followed by lowercase letters, digits or hyphens (`^[a-z][a-z0-9-]*$`).
Anything else fails with `invalid_name`.

### State of an instance

- `running`: a valid run record (`run.json`, written by `start`, or by `run` while it runs or with `--detach`) whose process is still alive and running this image.
- `running (untracked)`: no valid record, but some process has the instance's `.changes` file open
  (for example an image started by hand).
- `stopped`: otherwise. A stale record is ignored, never deleted.

### First use

The first `create` prepares the Cuis home: it downloads the pinned Cuis release (~30 MB),
verifies its SHA-256, unpacks it, builds the pristine base and smoke-boots a scratch copy
headlessly before publishing it. Later commands reuse it. If another process is already
preparing it, `create` waits for that to finish. A failed preparation is recorded and retried by
the next `create`.

## Output and exit codes

- stdout carries exactly one document; progress messages go to stderr.
- `cuisctl` never prompts and does not depend on the current directory. Only `run --stdin` reads standard input, and never from a terminal.
- `--json` is accepted anywhere on the command line and switches stdout to one JSON document;
  the exit code is the same.

| Exit code | Meaning |
|-----------|---------|
| 0 | ok |
| 1 | command error (including `not_saved`, `run_failed`, `run_timed_out`, `interrupted`) |
| 2 | usage error (`usage`) |

Text errors are `error: <message>`, plus a `hint: <hint>` line when there is one.

```
$ cuisctl status demo --json
{"ok":true,"command":"status","data":{"name":"demo","cuisKey":"7.8-d4f9cc1","createdAt":"2026-01-01T12:00:00.000Z","state":"stopped","paths":{"instance":"...","files":"...","log":"..."}}}

$ cuisctl status nope --json
{"ok":false,"error":{"kind":"not_found","message":"No instance named \"nope\"","hint":"cuisctl create nope"}}
```

Instance data (`create`, `status <name>`, `reset`) has `name`, `cuisKey`, `createdAt`, `state`
(`stopped` | `running` | `running_untracked`), `paths` (`instance`, `files`, `log`) and, when
running, `pid`, `mode`, `bridge`, `saveOnStop`, `startedAt` (`running_untracked` only has `pid`).
`status` without a name returns `{home: {state, error?}, instances: [...]}`.

### Error kinds

| Kind | Meaning |
|------|---------|
| `usage` | malformed command line: missing command or name, unknown command or option (for example `destroy --headless`), extra arguments; for `run`: no or several code sources, `--save` with `--detach`, `--headless` with `--gui`, bad `--timeout`, blank code, unreadable `--file`, `--stdin` from a terminal |
| `invalid_name` | instance name breaks the naming rule |
| `already_exists` | an instance with that name exists |
| `not_found` | no instance with that name |
| `unsupported_platform` | the command needs macOS |
| `cuis_fetch_failed` | the Cuis download failed |
| `cuis_checksum_mismatch` | the downloaded archive does not match the pinned SHA-256 |
| `cuis_write_failed` | a filesystem error (`EACCES`, `ENOSPC`, `EROFS`, `ENOENT`, `EPERM`, `ENOTDIR`) while preparing the Cuis home; not used when building an instance |
| `cuis_base_build_failed` | the smoke boot of the new base image failed |
| `cuis_corrupt` | the prepared Cuis home is missing files; delete the folder named in the hint and rerun |
| `busy` | another `cuisctl` command (`start`, `stop`, `reset`, `destroy`, `run`) is changing the same instance (or, for `start --bridge`, another bridged start did not finish within the start timeout) |
| `instance_running` | `start` on an instance running in another mode or bridge choice, or untracked; `stop` of an untracked holder that is not a Squeak VM; `reset`, `destroy` (even with `--yes`) or `run` of a running or untracked instance. Hint: `cuisctl stop <name>` |
| `port_in_use` | `start --bridge` and something accepts connections on `127.0.0.1:6789`; names the instance when it is one |
| `start_failed` | `start` or `run`: the instance was not ready in time, exited early, or the bridge was not loopback-only or its package is missing; includes the end of `vm.log` |
| `version_mismatch` | `start`, `reset` or `run` on an instance made from a Cuis version other than the pinned one |
| `confirmation_required` | `destroy` without `--yes`; nothing was deleted. Names the instance and files folders |
| `home_not_ready` | `reset` and the Cuis home is not ready (`missing`, `preparing` or `failed`); `reset` never prepares it. Hint: `cuisctl start <name>` |
| `not_saved` | `stop --save`, or `run --save` after a passed run, ended the VM but the image was not saved (exit 1; for `run` the run document is still reported) |
| `run_failed` | `run`: the code raised an error, was a syntax error, or the VM ended before it finished (exit 1; the run document is still reported) |
| `run_timed_out` | `run`: the code did not finish within `--timeout`; the VM was killed and the image restored (exit 1; the run document is still reported) |
| `interrupted` | `run` was interrupted by Ctrl-C or SIGTERM; the VM was killed and the image restored (exit 1) |
| `internal_error` | any error that is not a `cuisctl` error, with its message; includes raw filesystem errors while building an instance in `create` |

## Layout under `~/.cuisctl`

```
cuis/<key>/dist/          the Cuis distribution (VM, CoreUpdates, Packages), shared
cuis/<key>/base/          pristine image, changes and sources files
cuis/<key>.lock           held by the process preparing the install
cuis/<key>.error          last failed preparation ({kind, message})
cuis/<key>.tmp-<pid>/     in-progress preparation
instances/<name>/
  instance.json           name, Cuis key, creation time
  image/                  the instance's own image and changes (copies), sources (symlink)
  CoreUpdates             symlink into the shared distribution
  Packages/               real directories, each file a symlink into the shared distribution
  files/                  the instance's files
  vm.log                  VM output (appended; `start` and its failures log here)
  run.json                record of the running VM (pid, start time, mode, bridge, save on stop); written by `start` (and by `run` while it runs), removed by `stop`
  start.st                start script generated by each `start`
  ready                   written by the start script when the image is ready (`armed=true|false`)
locks/                    per-instance locks `<name>.lock` and `bridge.lock`, outside `instances/`
tmp/                      staging area used by create
```

`Packages/` is copy-on-write: saving a package inside an instance replaces that one symlink
with the instance's own copy and leaves the shared distribution untouched.

`CUISCTL_HOME` overrides `~/.cuisctl`; it exists for tests only.

Test seams (injected through the CLI context, never by `cli.ts`): `createOptions`,
`startOptions` (port, `startTimeoutMs`, `pollIntervalMs`, ...) and `stopOptions`
(`saveTimeoutMs`, `hardCapMs`, `killWaitMs`, `pollIntervalMs`). Tests use an ephemeral port,
never 6789.

## Tests

```
npm test
```

An opt-in suite runs against a real Cuis (downloads it; macOS only):

```
CUISCTL_REAL_CUIS=1 npm test
```

It also exercises `start` and `stop` with real headless VMs (bridge, save on stop, resume), `reset` recovery (an image saved with a runaway process that cannot start is reset and then starts) and `destroy`.
The GUI `start` test opens a real window on the desktop, so it needs one more opt-in:

```
CUISCTL_REAL_CUIS=1 CUISCTL_REAL_GUI=1 npm test
```
