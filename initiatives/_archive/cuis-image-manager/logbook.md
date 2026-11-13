---
status: archived
archived: 2026-11-13
started: 2026-11-07
research: closed
research-started: 2026-11-09
research-closed: 2026-11-11
---

## Retrospective

The initiative made named Cuis images first-class through the cuisctl CLI, delivered in three parts: part 01 core (14 phases; create, status, Cuis home, 27 invariants), part 02 lifecycle (17 phases, 105 cycles; start, stop, save on stop, bridge port handling, 22 invariants) and part 03 cleanup (11 phases, 30 cycles; reset, destroy and the cuisctl skill, 11 invariants). Research came first and closed on 2026-11-11, and its findings (signal trap, launch layout, bridge loading, stop semantics) shaped the design. All 60 invariants are covered, and the parts were checked against real headless Cuis VMs. The final suite is 253 passing tests plus the opt-in real-Cuis checks.

Across the parts, the original single spec was re-partitioned (and cuisctl was given its own Cuis installs rather than reusing the bridge's) before implementation. Notable deviations: runCli.ts holds the CLI logic with cli.ts as a thin entry; reset refuses to prepare a missing home (home_not_ready); the real GUI start test is gated behind CUISCTL_REAL_GUI=1 and was never run.

Lessons: many cycles in all three parts were characterization tests that passed at once, which loosens strict red-green; a check that cannot fail should be proven able to fail first (one invalid snapshot check was caught and redone in part 03); the fake VM needed fixtures to test untracked stop and save-on-stop; and the Smalltalk start script is exercised only by real-VM tests. Open items: a corrupt instance.json or run.json raises a raw error rather than a typed one; the start-racing-destroy window still ends in internal_error; the "never cut off a save in progress" extension (60 s cap) was chosen without user confirmation; invariant 10's skill check was the model following the skill, not an independent harness; and the tool is expected to move to its own repository once proven.
