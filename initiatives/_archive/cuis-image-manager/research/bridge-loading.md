---
started: 2026-11-10
updated: 2026-11-11
---

## Question

How does `start --bridge` load `MCP-Bridge.pck.st` and run `startOn:` exactly once, given that
a saved server resumes itself after relaunch? (Agenda question 7.) Also covers two open
questions in `prior-findings.md`: whether the bridge's re-listen branch matches stock, and what
causes two listeners on 6789 after a restart.

## Context

The bridge keeps its server in class-side state (`connectionQueue`, `pollProcess`) and uses no
start-up hooks. `prior-findings.md` showed that a saved server resumes after relaunch and
listens again without `startOn:`. `launch-layout.md` showed that the bridge's requirements
(JSON, Network-Kernel) resolve through the instance's `Packages` link. Research ran 2026-11-10
on macOS, Cuis 7.8, VM `7.20260327.1636`, headless, with port 17901 so the live bridge on 6789
was not touched. The test image was the armed base from `probes/q12`, with JSON, Network-Kernel
and the bridge loaded by explicit paths, `startOn: 17901`, then `saveAndQuit`. Scripts and logs
are in `probes/q13/`. `probe.sh` counts the VM's LISTEN sockets on 17901 every 0.5 s for 15 s,
then sends a handshake. The image copies were deleted after the runs.

## Findings

- [documented] `McpBridgeConnectionQueue>>listenLoop` matches stock `ConnectionQueue>>listenLoop`
  (live image via the MCP bridge) apart from one call in the `useOldNetwork` branch:
  `listenOn: portNumber backlogSize: 4 interface: (...'127.0.0.1')` in place of
  `listenOn: portNumber backlogSize: 4`. The re-listen branch (`socket isValid ifFalse: [...
  ^self listenLoop ]`) and `waitForAcceptFor: 10` are the same.
- [documented] `McpBridgeServer class>>stop` terminates `pollProcess` and sends `destroy` to the
  queue. `ConnectionQueue>>destroy` terminates the listener Process and destroys its socket
  and connections. `stop` on a server that never started is a no-op, because every variable is
  nil-checked.
- [tested] With no start script, a relaunched image whose server was running at save listens
  again after about 9.5 s, then answers the handshake. Trace `0000000000000000011111…`, 2 of 2
  runs (`R0-none-1..2.log`). [inferred] The delay is the resumed listener finishing its saved
  `waitForAcceptFor: 10` on the dead socket, then seeing `isValid` false and re-listening.
- [tested] A plain `McpBridgeServer startOn: 17901` in the start script gives **two**
  listeners. The new queue listens at about 0.5 s, and the resumed old queue adds a second at
  about 9.5 s. Trace `1111…12222…`, 2 of 2 runs (`R1-naive-1..2.log`). `startOn:` overwrites
  `connectionQueue` and `pollProcess` without stopping the old ones. This settles the "two
  listeners on 6789 after a restart" question: a resumed saved server plus a new `startOn:`.
- [tested] `McpBridgeServer stop; startOn: 17901` gives exactly one listener from about 0.5 s
  onward, and the handshake works. 2 of 2 runs (`R2-stop-start-1..2.log`).
- [tested] Port-in-use detection before launch (2026-11-11, `probes/q16/matrix.sh`,
  `matrix.txt`). Node v26.3.0 on macOS 25.6, each listener on its own fresh port; `connect` is
  a Node TCP connect to `127.0.0.1`, `bind*` are Node `listen()` test binds:

  | listener held by another process | lsof | bind 127.0.0.1 | bind 0.0.0.0 | bind default | connect |
  |---|---|---|---|---|---|
  | nothing | 0 | free | free | free | ECONNREFUSED |
  | 127.0.0.1 (Python) | 1 | EADDRINUSE | free | free | in-use |
  | 0.0.0.0 (Python) | 1 | free | EADDRINUSE | free | in-use |
  | :: dual-stack (Python) | 1 | free | EADDRINUSE | EADDRINUSE | in-use |
  | `nc -l` (no host) | 1 | free | EADDRINUSE | free | in-use |

  Only the connect probe and `lsof` caught every case; each test bind missed at least one. A
  bind on `127.0.0.1` succeeds next to a wildcard listener (`0.0.0.0` row: `bind127=free`).
  [inferred] This is the reverse of the `R4-busy-port` case, where the bridge's wildcard
  fallback bound next to a loopback listener; both suggest macOS allows a specific and a
  wildcard bind on the same port. [inferred] With a wildcard listener present the bridge's loopback bind would succeed, and
  `127.0.0.1` clients would reach whichever socket the OS prefers, so `cuisctl` must refuse in
  that case too. The connect probe tests exactly what the bridge's clients do.
- [tested] Within one session, `stop; startOn:` run twice 3 s apart also left exactly one
  listener, and the handshake worked (`R5-restart-in-session.log`). This contradicts the
  earlier Obsidian note in `prior-findings.md` that `stop` leaves the queue's socket bound and
  a stop/start cycle in one image gives two listeners. The two-listener cases seen before are
  explained by a plain `startOn:` without `stop`.
- [tested] "Start only if not running" (check `pollProcess` alive, else `startOn:`) found the
  resumed server alive (`ENSURE running=true`) and therefore also waited about 9.5 s for the
  listener (`R3-ensure-1..2.log`). Checking the Process says nothing about the socket.
- [tested] When another process already listens on `127.0.0.1:17901` (`nc -l`), the bridge
  does not fail. It listens on **all interfaces**. The log shows
  `sqSocketListenOnPortBacklogSizeInterface (bind): Address already in use`, and 12 s later
  `lsof` showed both `nc 127.0.0.1:17901` and `Squeak *:17901` in LISTEN (`R4-busy-port.log`,
  `R4-busy-port.txt`). [documented] The loopback bind fails, `listenLoop` then sees an invalid
  socket and calls stock `oldStyleListenLoop`, which uses `listenOn: portNumber` with no
  interface. macOS allows a wildcard bind next to a specific-address bind on the same port. The
  log line also shows that this image takes the `useOldNetwork` branch. This is a bridge
  defect (out of scope) that breaks its loopback-only invariant. For `cuisctl` it means the
  port must be checked before launch, because the bridge will not refuse.
- [documented] Loading needs the instance's `Packages` link so that the bridge's
  requirements resolve. `launch-layout.md` Conclusion: "Without the symlinks the same load
  fails silently". [tested, this session] An uncaught error in a `-s` script stops the script
  silently while the VM keeps running (`probes/q12/U2-error.log`: `ERR before` and no
  `ERR after`).

## Options

What the start script does when `start --bridge` runs:

- **Always `stop; startOn:`** (tested). One listener at about 0.5 s. Works on a fresh image, on
  a saved image with the server running, and on one where it was stopped.
- **Start only if not running** (tested). Avoids the duplicate but leaves a gap of up to about
  10 s after every relaunch.
- **Plain `startOn:`** (tested). Rejected: two listeners.

How the start script reports success:

- **Readiness file written as the script's last statement** (mechanism tested in Q6). If the
  load or `startOn:` fails, the script stops before the write, so a missing file means
  failure. `cuisctl` can also confirm with a handshake on the port.

## Rejected / dead ends

- Node test binds as the port check: each one missed at least one kind of listener (see
  Findings).
- The first port-matrix runs gave wrong rows. A connect check ran before the others and the
  one-shot `nc` exited after accepting it; on the rerun, Python holders failed to bind a port
  left in TIME_WAIT. Fixed by running connect last, a fresh port per row, and a liveness check
  on each holder.
- A plain `startOn:` in a saved image with a running server. It leaves two listeners
  (see Findings).

## Decisions

- Decision (user): `start` without `--bridge` stops a bridge server that resumed from the saved
  image (the start script sends `McpBridgeServer stop` when the class is loaded) — because
  without `--bridge` no bridge should run, and nothing should bind the port without the port
  check, since a taken port makes the bridge fall back to all interfaces. (Recommended by Claude, accepted by the user 2026-11-11.)
- Decision (user): open a GitHub issue for the bridge's all-interfaces fallback — because it
  breaks the bridge's loopback-only guarantee and fixing it is out of scope here, so it should
  be tracked where bridge work happens. (Recommended by Claude, accepted by the user 2026-11-11.)

## Conclusion

`start --bridge` should launch with a `-s` start script that:

1. Loads the bridge only when it is absent:
   `Smalltalk includesKey: #McpBridgeServer` else
   `CodePackageFile installPackage: <bridge .pck.st>`. JSON and Network-Kernel come through
   the `Packages` link.
2. Runs `McpBridgeServer stop; startOn: <port>`. This makes "exactly once" hold whether or not
   a saved server resumed. The listener is up in about 0.5 s instead of about 9.5 s.
3. Writes the readiness file last. A missing file means the load or the start failed, and
   `cuisctl` can confirm with a handshake.

The bridge needs no change for this. The duplicate listener comes from calling `startOn:`
without `stop`. Before launch, `cuisctl` must refuse if the port is in use: when the port is
taken, the bridge silently listens on all interfaces instead of failing. A TCP connect to
`127.0.0.1:<port>` detected every kind of listener tested; test binds did not.

## Open questions

- ~~Whether `start` without `--bridge` should stop a resumed server~~ Yes (see Decisions).
- ~~How `cuisctl` checks the port before launch~~ A TCP connect to `127.0.0.1:<port>`, or
  `lsof`; every Node test bind misses some listener (tested, see Findings).
- ~~Whether `lsof` sees listeners owned by other users without root~~ Out of scope: this
  machine has no other-user listeners to test against (`netstat -anv` and `lsof` listed the
  same seven, all owned by the user; 2026-11-11), creating one needs root, and the connect
  probe does not depend on it.
- ~~Whether to report the all-interfaces fallback as a bridge issue~~ Yes: opened as
  https://github.com/jolisper/Cuis-Smalltalk-MCP-Bridge/issues/10 (see Decisions).

## Sources

- `probes/q13/` (scripts, logs)
- `probes/q16/matrix.sh`, `bindcheck.mjs`, `connectcheck.mjs`, `holder.py`, `matrix.txt`
- `mcp-bridge/image/MCP-Bridge.pck.st` (`McpBridgeServer class>>startOn:`, `>>stop`,
  `McpBridgeConnectionQueue>>listenLoop`)
- `ConnectionQueue>>listenLoop`, `>>destroy`, `>>initPortNumber:queueLength:` (live image via
  the MCP bridge)
- `mcp-bridge/PROTOCOL.md` (handshake)
- `prior-findings.md`, `launch-layout.md`, `stop-semantics.md`
