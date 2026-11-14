# cuis-image-manager

## Problem

Cuis images are launched, stopped, restarted and cleaned up by hand. Every use means working out file paths, picking a port and checking by hand whether a previous process is still alive. Nothing records which images exist or which are running, so stale processes and port clashes are found only when something fails.

The MCP bridge is the first real client and feels this most. It needs a live image reachable on a fixed port, and today that depends on someone starting, restarting and cleaning up that image correctly each time.

There is also no structured home for the files a user accumulates per image, and no safe way to return an image to a known state without risking those files.

## Goals

- Make named Cuis images a first-class, manageable thing: created, started, stopped, inspected, reset and destroyed through one consistent interface.
- Let all images share one VM and one pristine base image, while each keeps its own image file and user files in a structured location.
- Make starting an image dependable for the MCP bridge: a live image on the bridge's fixed port, with a clear refusal when that port is already in use.
- Let a stopped image be discarded by default, or saved first when the user asks.
- Give a safe way to return an image to the pristine base without losing the user's own files.
- Make the state of the running images trustworthy, including detection of stale processes left behind by earlier runs.
- Serve both people and programs: readable output by default, structured output for machine callers.
- Work the same way from a terminal, from a thin Claude skill that wraps the tool, and from the MCP server or CI.

## Non-goals

- Fixing defects in the MCP bridge.
- Adding new bridge operations, such as writing code into a Workspace.
- Managing more than the one pinned Cuis version.
- Using, replacing or modifying the MCP bridge's own Cuis installation; `cuisctl` keeps its own.
- Running more than one bridged image at a time; the bridge's single fixed port rules this out.
- Saving on stop anywhere but macOS; Linux and Windows are not covered.

## Scope

The work is a new command-line tool plus a thin skill that wraps it. It downloads and maintains its own Cuis installations (VM plus pristine base, per pinned version, under `~/.cuisctl/`), independent of the bridge's, and it touches how an image is launched and how the bridge is loaded into it. The bridge itself is a client of the tool, not something being changed.

The tool is incubated in this repo because the bridge is its first real client, and is expected to move to its own repository once it has proved itself. That move shapes how self-contained the tool should be kept from the start. Effort is moderate: a small, well-bounded tool, with most of the risk in process and port handling and in the safety of reset and destroy.

Saving an image on stop relies on a small addition loaded into each image; research showed it works without changing the VM. It is still delivered last, so the rest of the tool is complete and can be used to test it.

## Open questions

All resolved in discussion with the initiative author; kept here so later stages can see the answers.

- Package location: resolved. A sibling package at the repo root, independent of the bridge's server package.
- Implementation language: resolved. TypeScript on Node 20 or later. Zig was considered and set aside for now.
- Final command name: resolved. `cuisctl`.
- Whether starting an image defaults to GUI or headless: resolved. GUI by default, with an option to run headless.
- Whether saving an image on stop belongs in the first version: resolved. Yes, delivered last. Research showed that stock Cuis can save and quit reliably with only a small loadable addition, and no VM change.
