# Research agenda: cuis-image-manager

Started: 2026-11-09

## Questions

1. Trap persistence: does a `startUp:` hook re-register the SIGTERM trap after a save and relaunch, and do class-side hooks survive a save?
   - Status: answered (tested). See `signal-trap-persistence.md`.
2. Reusable `SignalTrap`: can a small class with start-up and shut-down hooks deliver save-on-stop with no VM change, loadable into any managed image?
   - Status: answered (tested). Yes, with a one-class package. See `signal-trap-class.md`.
3. Trap robustness: how does the trap behave under a busy higher-priority Process, and while Morphic is mid-operation?
   - Status: answered (tested). It works only when the handler's priority is above the busy Process. Decision (user): the handler runs at 60. See `trap-robustness.md`.
4. Launch layout: where does Cuis look for `CoreUpdates` and `Packages` relative to the image, and what does the per-instance layout need?
   - Status: answered (tested). See `launch-layout.md`.
5. Headless launch pitfalls: is `-ApplePersistenceIgnoreState YES` reliable, and does a bare undeclared class name in a `-s` script really hang?
   - Status: answered (tested). The flag is reliable after the script arguments; a bare undeclared name does not hang. Compiles without an author, syntax errors and uncaught errors do. See `headless-pitfalls.md`.
6. Stop semantics: what should `stop` do when the trap is absent or unresponsive (SIGTERM, then SIGKILL after a timeout), and how are stale pids told from live ones?
   - Status: answered (tested). SIGTERM, poll, then SIGKILL; identify the process with `ps` or `lsof` on the `.changes` file. See `stop-semantics.md`.
7. Loading the bridge: how does `start --bridge` load `MCP-Bridge.pck.st` and run `startOn:` exactly once, given a saved server resumes itself after relaunch?
   - Status: answered (tested). Load if absent, then `stop; startOn:`, then write the readiness file. The port must be checked before launch. See `bridge-loading.md`.

## Out of scope

- Bridge defects (the `stop` listener leak, the stale MCP config path).
- New bridge operations, such as `show_in_workspace`.
- Linux and Windows signal support.
- More than one Cuis version.
