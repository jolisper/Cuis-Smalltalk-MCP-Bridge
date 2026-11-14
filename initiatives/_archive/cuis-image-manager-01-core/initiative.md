# cuis-image-manager (part 01: core)

Let all images share one VM and one pristine base image, while each keeps its own image file and user files in a structured location. Serve both people and programs: readable output by default, structured output for machine callers. It downloads and maintains its own Cuis installations (VM plus pristine base, per pinned version, under `~/.cuisctl/`), independent of the bridge's.

Part of [cuis-image-manager](../cuis-image-manager/initiative.md).
