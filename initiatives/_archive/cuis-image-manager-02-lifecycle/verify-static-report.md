# Static verify report — cuis-image-manager-02-lifecycle
Date: 2026-11-12

Test paths are relative to `cuisctl/src/`. Entries marked (real) are opt-in tests that run only with `CUISCTL_REAL_CUIS=1`; the rest run in the default suite against the fake VM.

Invariant 1 — `start <name>` starts the instance as a GUI image by default; `--headless` ...
  Static: covered — commands/start.test.ts:68 (headless), :104 (GUI default), :459 (bridge); realCuis.integration.test.ts:347, :369 (real). The real GUI test (:358) is gated behind CUISCTL_REAL_GUI=1 and was not run.

Invariant 2 — `start` returns only once the instance is ready ...
  Static: covered — commands/start.test.ts:459 (waits for the bridge handshake, elapsed ≥ 900 ms), :68; cli.test.ts:221 (the VM survives SIGHUP to the launcher's process group)

Invariant 3 — If the instance does not become ready within a bounded time ... `start` stops the VM, reports start-failed with the log tail ...
  Static: covered — commands/start.test.ts:134 (never ready), :173 (exits early); realCuis.integration.test.ts:447 (real, busy image)

Invariant 4 — `start` on an instance that does not exist fails with a not-found error.
  Static: covered — commands/start.test.ts:32

Invariant 5 — `start` on an instance already running with the same mode and bridge choice succeeds as a no-op ...
  Static: covered — commands/start.test.ts:204 (no-op), :238 (different mode), :573 (untracked)

Invariant 6 — `start --bridge` first checks whether anything accepts connections on `127.0.0.1` at the bridge port ...
  Static: covered — commands/start.test.ts:377 (foreign holder), :419 (names managed holder); portCheck.test.ts:37, :86, :114 (127.0.0.1, ::1, 0.0.0.0, ::)

Invariant 7 — At most one instance has the bridge on at any time ...
  Static: covered — commands/start.test.ts:615 (three iterations of two racing starts)

Invariant 8 — A bridged instance has exactly one bridge listener ...
  Static: covered — realCuis.integration.test.ts:387 (real only; the fake VM cannot reproduce a resumed saved bridge server). Unit: commands/start.test.ts:500 (non-loopback listener refused)

Invariant 9 — An instance started without `--bridge` has no bridge listening ...
  Static: covered — realCuis.integration.test.ts:398 (real); startScript.test.ts "without bridge, stops a loaded bridge server ..." (guarded stop in the generated script)

Invariant 10 — `cuisctl` never stops, signals or otherwise touches a process that is not one of its instances' VMs ...
  Static: covered — commands/start.test.ts:377, :573 (holders untouched); commands/stop.test.ts:313 (non-Squeak holder refused), :505 (forged start time); processControl.test.ts:27; staticChecks.test.ts:60 (process.kill only in processControl.ts and launcher.ts)

Invariant 11 — `stop <name>` ends the instance's VM without saving ...
  Static: covered — commands/stop.test.ts:44 (image unchanged), :539 (works when SIGTERM is ignored)

Invariant 12 — `stop --save <name>` asks the instance to save and quit, and waits ...
  Static: covered — commands/stop.test.ts:77 (saved), :111 (unavailable), :145 (never hangs), :189 (save in progress is not cut off); realCuis.integration.test.ts:410 (real). The open question about cutting off a save in progress is implemented as a hard-cap extension (see :189).

Invariant 13 — A saved instance's next `start` resumes the saved state, including user code running at save time.
  Static: covered — realCuis.integration.test.ts:423 (real only; needs a real image)

Invariant 14 — `stop` on a stopped instance succeeds as a no-op ...; any stale record is cleared.
  Static: covered — commands/stop.test.ts:351

Invariant 15 — `stop` also stops an instance that is running untracked.
  Static: covered — commands/stop.test.ts:233 (plain), :271 (--save)

Invariant 16 — Stopping never touches the instance's user files ...
  Static: covered — commands/stop.test.ts:460 (files/ identical after start/stop and start/stop --save); realCuis.integration.test.ts:467 (real)

Invariant 17 — Saving on stop is available on macOS only. Where it is unavailable ... `stop --save` reports "stopped, not saved".
  Static: covered — commands/start.test.ts:542 (status shows unavailable); commands/stop.test.ts:111; realCuis.integration.test.ts:495 (real, plugin-less VM)

Invariant 18 — Two `cuisctl` commands that change the same instance at the same time never interleave ... `status` is never blocked.
  Static: covered — commands/instanceLock.test.ts:47; commands/start.test.ts:336; commands/stop.test.ts:382; runCli.test.ts:498 (status never blocked, home unchanged)

Invariant 19 — Commands on different instances proceed independently, except for the bridge port rule.
  Static: covered — commands/instanceLock.test.ts:99; commands/start.test.ts:615 (the bridge exception)

Invariant 20 — An instance made from a different version is reported with its version and refused by `start` and `reset` ...
  Static: covered — commands/start.test.ts:46 (start refused), commands/stop.test.ts:428 (status reports the version, stop still works). Gap: `reset` does not exist yet (part 03), so its refusal is untested.

Invariant 21 — The MCP bridge and its tools are unchanged; a bridged instance serves the same protocol ...
  Static: covered — realCuis.integration.test.ts:369 (real: handshake with the protocol version read from protocol.ts, then list_categories); staticChecks.test.ts:25 (no imports from mcp-bridge in src). mcp-bridge/server's own suite passed unchanged in the implementation run.

Invariant 22 — A stop without `--save`, a failed start and a failed `stop --save` never alter the instance's image file.
  Static: covered — commands/start.test.ts:134 (failed start), :500; commands/stop.test.ts:44 (plain stop), :111, :145 (failed --save); realCuis.integration.test.ts:410, :447 (real)

22 invariants — 22 covered, 0 uncovered
