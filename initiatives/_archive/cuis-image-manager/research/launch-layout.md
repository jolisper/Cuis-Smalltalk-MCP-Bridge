---
started: 2026-11-09
updated: 2026-11-10
---

## Question

Where does Cuis look for `CoreUpdates` and `Packages` relative to the image, where do user files
go, and what does the per-instance directory layout need? (Agenda question 4.) Grown during
the research to cover how required packages are found, shared between instances of the same
version, saved, and reloaded.

## Context

The draft layout keeps each instance's image under `instances/<name>/image/` and user files
under `instances/<name>/files/`, with the VM and `CoreUpdates`/`Packages` in the shared `dist/`.
Earlier, a GUI image started from a directory holding only the image files showed "Could not
find a CoreUpdates folder / No updates loaded" (user screenshot, session image 9; also in
`tmp-cuis-image-manager-research.md`). Research ran 2026-11-09 to 2026-11-10 on macOS, Cuis
7.8, VM `7.20260327.1636`, against the live image through the MCP bridge and headless probes on
fresh copies of the base image. Scripts and logs are in
`/private/tmp/claude-501/-Users-jolisper-Source-Cuis-Smalltalk-MCP-Bridge/4a067712-58f9-49e9-ab4d-65ce3b79ebe4/scratchpad/`
under `q4/` to `q7/` (not committed). The user framed two cases to settle: the `CoreUpdates`
dependency at startup, and the packages the MCP bridge requires.

## Findings

- [documented] The base directory is derived from the image's folder. `DirectoryEntry class>>
  cuisBaseDirectory`: "If the directory containing the image has siblings named CoreUpdates or
  Packages, it means that the parent is the Cuis Base Directory"; otherwise "hopefully the
  required folders shold be inside the image folder" and the image folder is the base. Source:
  live image, `get_method_source DirectoryEntry class>>cuisBaseDirectory`.
- [documented] `coreUpdatesDirectory` is `DirectoryEntry cuisBaseDirectory / 'CoreUpdates'` and
  `packagesDirectory` is `cuisBaseDirectory / 'Packages'` (live image,
  `DirectoryEntry class>>coreUpdatesDirectory`, `>>packagesDirectory`).
- [documented] The dialog comes from the `-u` start-up option: `SystemDictionary>>
  processFinalCommandLineOption:optionArgument:raiseExceptions:` runs `[ '-u' ] -> [ ChangeSet
  installNewUpdates ]`, and `ChangeSet class>>installNewUpdates` does `updatesFileDirectory
  exists ifFalse: [ ^self inform: 'Could not find a CoreUpdates folder\No updates loaded' ... ]`.
  `RunCuisOnMac.sh` in `dist/` launches the VM with `-u` (`"$VM" CuisImage/Cuis7.8.image -u
  "$@"`).
- [documented] What `-u` does, `ChangeSet class>>installNewUpdates:` (live image): (1)
  `self newUpdates: updatesFileDirectory do: [ :each | self install: each ]`; (2) for each
  installed package with a `fullFileName`, compare `CodePackageFile providedFeatureInFile:` with
  `package provides` and print "Package: <name>. There is a newer version than currently
  loaded." (or "...has unsaved changes, but there is a newer version of the file.") when the file
  is later; (3) if any warning was printed, `inform:` "Some package(s) loaded in the image have
  updated package file on disk. Please see Transcript."; otherwise print
  `Smalltalk systemInformationString`. It never reloads packages. How `newUpdates:do:` decides
  which update files are new was not read.
- [documented] `CoreUpdates` holds core-system change sets published after a release —
  `dist/CoreUpdates/CoreUpdates.md`: "This directory holds Cuis critical updates (ChangeSets)
  published after the official release." In the pinned 7.8 `dist/` that file is the only
  entry, so `-u` has no updates to apply.
- [documented] The user base directory comes from the process's working directory.
  `DirectoryEntry class>>userBaseDirectory` uses `self workingDirectory` unless it is the root;
  if that is nil or equals `cuisBaseDirectory`, it uses `<cuisBaseDirectory parent>/<name>-
  UserFiles` and creates it (`assureExistence`). Its comment lists `SavedChangeSets`,
  `Packages`, `UserChanges`, `FileOuts` and `Logs` under it. `projectBaseDirectory` is
  `cuisBaseDirectory parent`.
- [inferred] `DirectoryEntry class>>releaseClassCachedState` sets `CuisBaseDirectory`,
  `UserBaseDirectory`, `ProjectBaseDirectory`, `CurrentDirectory`, `ImageDirectory` and
  `VMDirectory` to nil, so they are recomputed after a save and relaunch. What calls it at save
  time was not checked.
- [tested] Layout test, headless, working directory = `files/`, probe script `q4/probe.st`
  printing `DirectoryEntry cuisBaseDirectory`, `userBaseDirectory` and whether
  `coreUpdatesDirectory`/`packagesDirectory` exist (`q4/linked.log`, `q4/bare.log`):

  | Layout | cuisBaseDirectory | userBaseDirectory | CoreUpdates / Packages exist |
  |---|---|---|---|
  | `linked/image/` with `linked/CoreUpdates` and `linked/Packages` symlinked to the shared `dist/` | `.../q4/linked` | `.../q4/linked/files` | true / true |
  | `bare/image/` only | `.../q4/bare/image` | `.../q4/bare/files` | false / false |

  Both runs exited 0. This matches the dialog seen in the GUI image launched from a bare
  directory.
- [tested] The MCP bridge is a working end-to-end case for the linked layout (suggested by the
  user: it depends on JSON and network packages). `mcp-bridge/image/MCP-Bridge.pck.st:5-6`
  declares `!requires: 'JSON' 1 29 nil!` and `!requires: 'Network-Kernel' 1 12 nil!`. Headless
  probe `q4/bridge.st` ran `CodePackageFile installPackage:` on that file alone, from
  `files/`, in both layouts (`q4/linked-bridge.log`, `q4/bare-bridge.log`; both exit 0, no
  package preloaded in the base image: `pre packages=#()`):
  - `linked`: `Package JSON successfully installed`, `Package Network-Kernel successfully
    installed`, `Package MCP-Bridge successfully installed`; afterwards
    `#('Network-Kernel' 'MCP-Bridge' 'JSON')` and `Smalltalk includesKey: #McpBridgeServer`
    true. The required packages were found without any explicit path.
  - `bare`: no output beyond the probe lines; `post packages=#()` and `McpBridgeServer` absent.
    The install failed silently, with exit 0 and no error or notification printed.
  Where the required packages were found was inferred here; the follow-up H2a run below
  printed it (`Packages/Features/JSON.pck.st`, `Packages/System/Network-Kernel.pck.st`).
- [documented] Why the bare install is silent: `CodePackageFile class>>installPackage:` runs
  `req satisfyRequirementsAndInstall` and handles `FeatureRequirementUnsatisfied` with
  `[ :ex | PopUpMenu inform: ex messageText ]`, which prints nothing headless (live image,
  `get_method_source`).
- [documented] Requirement search order, `FeatureRequirement>>placesToLookForPackagesDo:`
  (live image): the requiring package's own folder ("Look inside my own folder"), the
  `codePackageFile` folder, `DirectoryEntry packagesDirectory` and all folders under it
  ("Packages that come included with Cuis"), `DirectoryEntry newPackagesDirectory`
  (`userBaseDirectory / 'NewPackages'`, "Packages created by user"), then
  `DirectoryEntry projectBaseDirectory` and all folders under it ("Packages in other folders or
  repos in the project directory").
- [tested] Follow-up test, 2026-11-10 (scratchpad `q5/`; fresh base copies, headless,
  working directory = `files/`, probe `q5/install.st` calls `satisfyRequirementsAndInstall`
  directly with `FeatureRequirementUnsatisfied` printed, then prints each installed package's
  `fullFileName`):
  - H1 bare layout (`q5/h1-bare.log`): `unsatisfied: 'Could not find code package file for
    [Network-Kernel].`, `bridgeClass=false`. Confirms the silent failure is an unsatisfied
    requirement.
  - H2a only `Packages` symlinked (`q5/h2a-pkg.log`): JSON and Network-Kernel loaded from
    `h2a-pkg/Packages/Features/JSON.pck.st` and `h2a-pkg/Packages/System/Network-Kernel.pck.st`,
    `bridgeClass=true`. `Packages` alone is enough for the bridge.
  - H2b only `CoreUpdates` symlinked, isolated in its own parent (`q5/h2b-iso.log`):
    `cuisBase=.../iso/h2b-cu` (the `CoreUpdates` sibling is enough to move the base up), but
    `unsatisfied: 'Could not find code package file for [Network-Kernel].`. `CoreUpdates` alone
    does not satisfy requirements.
  - H2b first run, not isolated (`q5/h2b-cu.log`): with sibling test folders in the same
    parent, it loaded JSON and Network-Kernel from `q5/h0-linked/Packages/...`, a sibling
    folder reached through `projectBaseDirectory` (`<q5>`) and a symlink. The directory walk
    follows symlinks.
  - H3 search places printed per layout match the documented order: e.g. bare printed
    `image/Packages`, `files/NewPackages`, then `h1-bare` and its subfolders; linked printed
    `Packages`, `Packages/Features`, `Packages/System`, ..., `files/NewPackages`, then the
    parent folder and every folder under it (47 places in `h2a-pkg`).
- [tested] Cross-instance package sharing works (H4). Layout `q5/instances/{A,B}`, both linked.
  A defined class `ProbeSharedThing` (category `ProbeShared`, `answer ^ 42`), created
  `CodePackage named: 'ProbeShared'`, set its `fullFileName` to
  `DirectoryEntry newPackagesDirectory // pkg packageFileName` and ran `save`
  (`q5/a-create.st`): `saved to .../instances/A/files/NewPackages/ProbeShared.pck.st`. B ran
  `Feature require: 'ProbeShared'` (`q5/b-require.st`): `projectBase=.../instances`,
  `loaded ProbeShared from '.../instances/A/files/NewPackages/ProbeShared.pck.st'`,
  `answer=42`. The user raised this as a desirable workflow: develop a package in one live
  image that another image needs.
- [tested] `CodePackage>>save` with no `fullFileName` asks for a path (`self request: 'Save on
  path: '`, live image source), which would block headless. Setting `fullFileName` first
  avoided the prompt (`q5/a-create.st`, exit 0).
- [tested] Saving a shipped package writes through the `Packages` symlink into the shared
  folder. Scratch copy of `dist/Packages` (only `Features/JSON.pck.st`), instance `q6/iso/S`
  with `Packages -> q6/fakedist/Packages`, probe `q6/save.st` (`q6/save.log`, exit 0):
  `Feature require: 'JSON'` gave `fullFileName='.../iso/S/Packages/Features/JSON.pck.st'`
  (the path through the link); compiling `Json>>probeSharedWrite` made `hasUnsavedChanges`
  true; `pkg save` wrote to the same path. The scratch shared `JSON.pck.st` changed md5 and
  contains `probeSharedWrite`; no copy appeared inside the instance; the real
  `dist/Packages/Features/JSON.pck.st` was unchanged. So an edit saved in one instance changes
  the package file for every instance of that version.
- [inferred] Other instances do not pick the change up by themselves: a running or saved image
  keeps the code it loaded, and only a reload of the package (or a first load in an instance
  that never loaded it) reads the new file. `ChangeSet class>>installNewUpdates:` (run by `-u`)
  only warns, printing "There is a newer version than currently loaded", and only when
  `providedFeatureInFile isLaterThan: package provides` (live image source).
- [tested] `CodePackage>>save` bumps the package's minor version, and `-u` in another instance
  then warns but does not reload (scratchpad `q7/`; two instances S and T sharing a scratch
  `Packages` through symlinks). T loaded JSON and saved its image (`t-load.log`: `loaded
  provides=Feature(JSON 1.29)`). S loaded JSON, added `Json>>probeSharedWrite`, saved the
  package (`s-edit.log`: before `JSON 1.29`, after `JSON 1.30`; the file's first line went from
  `!provides: 'JSON' 1 29!` to `!provides: 'JSON' 1 30!`). T relaunched with
  `-d 'Transcript logToStdout: true' -u` (`t-check3.log`): `Package: JSON. There is a newer
  version than currently loaded.`, then `loaded provides=Feature(JSON 1.29)`, `file
  provides=Feature(JSON 1.30)`, `hasProbeMethod=false`. T kept the old code.
- [tested] How another instance reloads a package changed on disk. Instance T (saved with
  JSON 1.29 loaded; shared file at 1.30 with `Json>>probeSharedWrite`), three fresh runs from
  the same saved state (`q7/r1-require.log`, `q7/r2-require-version.log`,
  `q7/r3-installPackage.log`, all exit 0):

  | Method | After |
  |---|---|
  | `Feature require: 'JSON'` | still `JSON 1.29`, `hasProbeMethod=false` (no-op: already satisfied) |
  | `Feature require: 'JSON' version: 1 revision: 30` | `Package JSON successfully installed`, `JSON 1.30`, `hasProbeMethod=true` |
  | `CodePackageFile installPackage: (CodePackage installedPackages at: 'JSON') fullFileName asFullFileEntry` | `Package JSON successfully installed`, `JSON 1.30`, `hasProbeMethod=true` |

  [documented] `installPackage:` reloads because it calls
  `FeatureRequirement>>satisfyRequirementsAndInstall`: "Like #require, but install me even if
  already satisified (i.e. installed)" (live image source).
- [tested] Reloading over unsaved local changes asks first, and "Yes" discards them. Instance T
  (saved with JSON 1.29), each run starting from that state: recompile an existing method
  (`Json>>ctorMap` to `^ #localEdit`) and add `Json>>probeLocalOnly`, both unsaved, then reload
  from the shared 1.30 file (`q7/u1-installPackage.log`, `q7/u2-require-version.log`,
  `q7/u3-yes-branch.log`):
  - `CodePackageFile installPackage:` hung until killed at 90 s (rc 137). [documented] Cause:
    `FeatureRequirement>>install` asks `self confirm: 'If you install this package, there are
    unsaved changes that will be lost.', ... 'Continue?'` when `existing hasUnsavedChanges`, and
    `Object>>confirm:` is a modal `PopUpMenu` ("the user must respond yes or no"). No
    answer-supplying hook exists (`valueSupplyingAnswer:` has no implementors).
  - The "Yes" branch, run directly as `((FeatureRequirement name: 'JSON') pathName: ...)
    codePackageFile install`: `Package JSON successfully installed`, `unsaved=false`,
    `probeSharedWrite` present, `probeLocalOnly` gone, `ctorMap` back to the file's version.
    All local changes to the package were discarded, not merged.
  - [documented] The "No" branch skips the install, keeping local changes and the old code.
- [tested] A local unsaved edit bumps the package's in-memory version: after the edits above,
  T reported `provides=Feature(JSON 1.30)` before any reload (it had loaded 1.29). So
  `Feature require: 'JSON' version: 1 revision: 30` was already satisfied and did nothing
  (`u2-require-version.log`: local changes kept, `probeSharedWrite` absent). Version numbers
  alone cannot tell a local edit from the shared file's newer version.
- [tested] The `-u` package check only runs when a `CoreUpdates` folder is found. T without a
  `CoreUpdates` link printed no warning (`t-check2.log`), because `installNewUpdates` returns at
  the "Could not find a CoreUpdates folder" check before checking packages. Options run in
  command-line order: `-d` before `-u` turned on stdout logging in time to capture the
  warning.
- [tested] H0 `-u` headless: linked layout printed `coreUpdatesExists=true`, bare printed
  `false`; both exited 0, so the `inform:` in the bare case did not block a headless boot
  (`q5/h0-linked.log`, `q5/h0-bare.log`). The shared `dist/CoreUpdates` holds only
  `CoreUpdates.md`, so there were no updates to install. Whether the GUI dialog is gone in the
  linked layout was not observed.
- [tested] A GUI launch with `-u` from the linked layout gets past the `CoreUpdates` check, so
  no dialog. Fresh base copies in `q8/linked` and `q8/bare`, GUI (no `-headless`), working
  directory `files/`, `-l watch.st -u` (`q8/linked.log`, `q8/bare.log`; both killed by the
  40 s watchdog, rc 137). Linked printed `Cuis7.8`, `latest update: #7977`, `Running at
  :.../q8/linked/image/Cuis7.8.image`: that is `Smalltalk systemInformationString`, which
  `installNewUpdates:` prints only at its end, after the folder check passed and no package
  warning fired. Bare printed nothing, consistent with returning at the "Could not find a
  CoreUpdates folder" inform (seen on screen in session image 9).
  Confirmed directly with a self-check (`q8/watch3.st`, loaded with `-l` before `-u`): a
  process forked at `userInterruptPriority` waits 8 s, walks `UISupervisor ui allMorphsDo:`
  for any `contents` string containing "CoreUpdates", prints the result and quits. Bare
  (`q8/bare-3.log`): `dialog text: 'Could not find a CoreUpdates folder'`,
  `dialogShown=true`. Linked (`q8/linked-3.log`): `dialogShown=false`. Both exit 0. The modal
  inform in the bare run did not stop the higher-priority watcher.
- [tested] `-l <file>` runs in a GUI launch, in command-line order before `-u`: `q8/watch2.st`
  printed `-l ran` in both layouts (`q8/bare-2.log`, `q8/linked-2.log`). The first watcher
  (`q8/watch.st`) printed nothing because its forked block failed with `MessageNotUnderstood
  'WorldMorph>>allMorphs'`, which a GUI image does not print to stdout; wrapping the block in
  `on: Error do:` surfaced it. A `-l` file is filed in as chunks, so it needs a trailing `!`.
### Answers to earlier open questions (2026-11-10, scratchpad `q9/`)

Each entry quotes the open question as it was written, then the answer. All runs used fresh
copies of the base image, launched from the instance's `files/` folder unless stated.

**Q: "Do change sets, logs and `UserChanges` end up under the instance's `files/` folder in
practice?"**
- [tested] Yes. `q9/A.st` in a linked instance (`q9/A.log`, exit 0) printed every user folder
  under `files/`: `userChangesDirectory=.../U/files/UserChanges`,
  `fileOutsDirectory=.../files/FileOuts`, `logsDirectory=.../files/Logs`,
  `savedChangeSetsDirectory=.../files/ChangeSets`, `newPackagesDirectory=.../files/NewPackages`.
  After compiling one method the tree held `files/UserChanges/Cuis7.8.user.changes`, so code
  changes are logged there, next to the image's own `image/Cuis7.8.changes`.
- [tested] Class `fileOut` wrote nothing headless (no `ProbeUserFiles.st` anywhere, though the
  call returned). [documented] `Class>>fileOut` goes through `DirectoryEntry
  fileOutsDirQuery:writeStreamDo:` → `userDirectory: 'FileOuts' queryFileName:`, which asks the
  user for the file name; with no answer headless, nothing is written. The suggested folder is
  `files/FileOuts`.

**Q: "Should the shared `dist/` be read-only to stop saves writing through the `Packages`
link, or should users copy a shipped package before editing it?"** (design choice, owner: the
user; tested what read-only does)
- [tested] A read-only shared package makes `save` fail cleanly. Scratch shared folder with
  `JSON.pck.st` at `-r--r--r--` and its folders at `555` (`q9/B.st`, `q9/B.log`, exit 0):
  `save error: CannotDeleteFileException 'Could not delete the old version of file
  .../R/Packages/Features/JSON.pck.st'`; afterwards `unsaved=true`, in-memory version
  `JSON 1.30`, and the shared file's md5 unchanged. The edit stays in the image and in
  `UserChanges`; nothing reaches other instances.
- [tested] Read-only `dist/` simulated end to end (scratchpad `q10/`: `rodist/` with
  `Packages/Features/JSON.pck.st` and `CoreUpdates/`, `chmod -R a-w`; instances `X` and `Y`
  linked to it):
  - GUI save (`q10/R1b-gui.st`, `R1b.log`, exit 0): JSON loaded, `Json>>probeReadOnly`
    added, `save` run in the UI process via `UISupervisor whenUIinSafeState:`. A debugger
    window opened, titled `'CannotDeleteFileException: Could not delete the old version of file
    .../X/Packages/Features/JSON.pck.st - Process: Morphic UI ...'`; `unsaved=true`; shared file
    md5 unchanged.
  - Escape hatch, save a copy to the instance's own `NewPackages` (`q10/R2-saveas.st`,
    `R2-saveas.log`; the path set directly, as the user would accept the suggested
    `NewPackages` path): first `save` failed with `CannotDeleteFileException`; after pointing
    the package's `fullFileName` at `DirectoryEntry newPackagesDirectory`, `save` wrote
    `.../X/files/NewPackages/JSON.pck.st`, `unsaved=false`, `provides=Feature(JSON 1.30)`.
  - Another instance with a plain requirement (`q10/R3-require.st`): `Feature require: 'JSON'`
    loaded the shared `.../Y/Packages/Features/JSON.pck.st`, `JSON 1.29`, no probe method. The
    shared `Packages` is searched before the `instances/` walk, so the copy is shadowed.
  - Another instance asking for the newer version (`q10/R4-require-1-30.st`): `Feature require:
    'JSON' version: 1 revision: 30` skipped the shared 1.29 and loaded
    `.../X/files/NewPackages/JSON.pck.st`, `JSON 1.30`, probe method present.
- [tested] A `-l` file-in swallows errors: the same save run directly inside the `-l` chunk
  (`q10/R1-gui.st`, `R1.log`) opened no debugger and printed no error; the chunk text was
  echoed to stdout and execution continued. [documented] `processFinalCommandLineOption:...`
  wraps `-l` in `on: exceptionToIgnoreOrNil do: [ :ex | ex return ]`. Code loaded by
  `cuisctl` with `-l` would fail silently the same way.

**Q: "How does `ChangeSet class>>newUpdates:do:` pick which `CoreUpdates` files are new?"**
- [documented] `newUpdates:do:` (live image) keeps files whose name `beginsWith:
  SystemVersion current updatesPrefix`, reads the integer right after the prefix
  (`integerOrNilAt:`), keeps those with `updateNumber > SystemVersion current highestUpdate`,
  sorts by name and installs each with `ChangeSet class>>install:` (a `fileIn` into a separate
  change set).
- [tested] Fake `CoreUpdates` folder (`q9/C-coreupdates/fakeCU`), `-d 'Transcript logToStdout:
  true' -u -s C.st`. Prefix is `'[r7.8]-'`, highest update `7977`. Files without the prefix
  were ignored (`C.log`: `ProbeUpdateOrder='none'`). With the prefix (`C2.log`): `Installed
  ChangeSet: [r7.8]-7978-...` then `...7979-...`; `7977` (equal to highest) and
  `[r7.8]-Probe-NoNumber.cs.st` were skipped; order `'7978 7979 '`; afterwards `latest update:
  #7979`. Installing updates raises the image's highest update number.

**Q: "What calls `releaseClassCachedState` at save time?"**
- [documented] `SystemDictionary>>snapshot:andQuit:embedded:clearAllClassState:` (the main
  save/quit method, live image) runs `self allClassesDo: [ :cls | cls releaseClassCachedState ]`
  before the snapshot, after storing `userBaseDirectory` in a local. When the image resumes
  without a real startup (a save that keeps running), it restores it with `DirectoryEntry
  setUserBaseDirectory: userBaseDirectory`; on a real startup it is recomputed.
- [tested] So the user folder follows the launch directory, not the saved state. Instance
  `q9/D-relaunch/iso/W`: run 1 from `files/` printed `userBase=.../W/files` and saved
  (`D1.log`); run 2 of the saved image from `q9/D-relaunch/elsewhere` printed
  `userBase=.../elsewhere cuisBase=.../W` (`D2.log`).

**Q: "Does the reload confirm appear in the GUI as expected (only seen as a headless hang)?"**
- [tested] Yes. GUI launch (`q9/E.st` loaded with `-l`, `E.log`, exit 0): JSON loaded from a
  writable scratch shared folder, `Json>>probeLocalOnly` added (`unsaved=true`), then
  `CodePackageFile installPackage:` on the JSON file. A watcher forked at
  `userInterruptPriority` found on screen `'If you install this package, there are unsaved
  changes that will be lost.'` (`confirmShown=true`), and `probeLocalOnly` was still present
  while the confirm waited.

**Q: "With two instances holding packages of the same name, which copy wins?"**
- [tested] The first one in the filesystem's raw directory order, not alphabetical. Instances
  `zeta` then `alpha` each saved a `ProbeDup` package (`origin` answers its instance name) to
  their `files/NewPackages` (`F-zeta.log`, `F-alpha.log`); instance `mid` ran `Feature
  require: 'ProbeDup'` (`F-mid.log`): its places listed `.../zeta/files/NewPackages`,
  `.../mid/files/NewPackages`, `.../alpha/files/NewPackages` in that order, and it loaded
  `.../zeta/files/NewPackages/ProbeDup.pck.st`, `origin='zeta'`. `ls -f instances/` gave the
  same raw order `zeta mid alpha`. [inferred] The order is whatever the filesystem returns
  (APFS here), so it is not something a user can rely on.

**Q: "Does the `projectBaseDirectory` walk get slow as instances and their files grow?"**
- [tested] It grows linearly, about 3 ms per instance. One real linked instance plus N dummy
  instance folders (each with `image/`, `files/NewPackages`, `files/UserChanges`, `log/` and
  `Packages`/`CoreUpdates` links to the shared `dist/`), `q9/G.st` timing the full place
  walk and a failing `Feature require: 'NoSuchPackage'` (`G-1.log`, `G-10.log`, `G-50.log`):

  | Dummy instances | Places | Walk ms | Failed require ms |
  |---|---|---|---|
  | 1 | 24 | 11 | 10 |
  | 10 | 114 | 40 | 37 |
  | 50 | 514 | 156 | 162 |

  [inferred] The walk is only reached when a requirement is not found earlier (own folder,
  shared `Packages`, own `NewPackages`), so normal loads of shipped packages do not pay it.

- [tested] Working recipe for the layout (shell, from this session):

  ```sh
  mkdir -p inst/image inst/files
  cp base/Cuis7.8.image base/Cuis7.8.changes inst/image/
  ln -s base/Cuis7.8.sources inst/image/Cuis7.8.sources
  ln -s dist/CoreUpdates inst/CoreUpdates
  ln -s dist/Packages    inst/Packages
  (cd inst/files && Squeak -headless ../image/Cuis7.8.image -s probe.st)
  ```

## Options

Ways to protect the shared `dist/Packages` from saves written through the symlink, as found
(the user chose read-only `dist/`; see Decisions):

- **Writable `dist/` (as today).** No friction; an edited shipped package saved in one instance
  changes the file for every instance of the version and bumps its version (tested). Other
  instances keep their loaded code until they reload, and `-u` only warns.
- **Read-only `dist/`.** The shared files cannot change (tested). Saving a shipped package
  opens a `CannotDeleteFileException` debugger in the GUI; the edit stays in the image and
  `UserChanges`. Saving a copy to the instance's `files/NewPackages` works; other instances
  ignore that copy on a plain `Feature require:` (shared `Packages` is searched first) and load
  it only when they ask for its newer version (tested).
- **Copy before editing (convention, not enforced).** Not tested as such; the save-as to
  `NewPackages` above is the same mechanism, done before the first save instead of after a
  failure.

## Rejected / dead ends

- Using `-u` with a headless run to reproduce the dialog was not attempted at first, on the
  assumption that `inform:` would block a headless boot. The 2026-11-10 run showed it does not.
- The first H3 probe asked a fresh `FeatureRequirement` with no `pathName` for its places, so
  the "own folder" entry did not appear in the printed lists; the order was checked against the
  rest of the list and the source.
- GUI dialog check by screenshot: `screencapture -x` failed ("could not create image from
  display", no screen-recording permission) and the user could not report the window in time;
  restarted from scratch. The first self-check (`q8/watch.st`) printed nothing, which was first
  misread as `-l` not running; the cause was an error in the forked block (see Findings).
- The first H2b run was confounded by sibling test folders in the same parent; rerun isolated.
- First GUI read-only save test (`q10/R1-gui.st`) ran `save` directly inside the `-l` chunk;
  `-l`'s exception handler swallowed the error, so no debugger appeared. That did not match a
  user's Save click; rerun with `UISupervisor whenUIinSafeState:` (`R1b-gui.st`).

## Decisions

- Decision (user): `cuisctl` does not force any package update; reloading a changed package is
  left to the user inside the image — rationale not stated.
- Decision (user): the shared `dist/` is read-only — because it keeps the shared base pristine
  (the initiative's non-goal of not modifying it, and a meaningful reset), makes a save of a
  shipped package fail loudly in the GUI instead of silently changing every instance, and still
  allows saving a copy to the instance's `NewPackages`. Accepted caveats: saves in `-l`-loaded
  code fail silently headless, and same-name copies in several instances load by raw directory
  order. (Recommended by Claude, accepted by the user 2026-11-10.)

## Conclusion

Cuis resolves `CoreUpdates` and `Packages` from the image folder's parent when that parent has
either as a sibling of the image folder, and takes user files from the process's working
directory. With symlinks to the shared `dist/` placed next to each instance's `image/` folder,
and the process started with the working directory set to the instance's `files/` folder, the
probe resolved both as intended, and the bridge package loaded together with its JSON and
Network-Kernel requirements. Without the symlinks the same load fails silently, because the
installer turns an unsatisfied requirement into a headless no-op `inform:`. Only `Packages`
matters for requirements; `CoreUpdates` matters for `-u` and also moves the base directory up.

For the user's two cases: `CoreUpdates` is read only by `-u`, which applies post-release core
change sets (none in the pinned 7.8) and warns about package files newer than the loaded code;
the bridge's required packages need only the `Packages` link.

All instances of one version share `Packages` and `CoreUpdates` through the links. Requirements
are also searched in every folder under the base directory's parent, following symlinks, so with
instances side by side one image can load a package another saved to its `files/NewPackages`
(tested); the same walk makes the result depend on whatever else sits in that parent folder.
Saving a shipped package writes through the link into the shared `dist/` and bumps its minor
version. Other instances keep their loaded code; `-u` only warns. A reload needs
`installPackage:` or a versioned `Feature require:`; over unsaved local edits it asks a modal
confirm, and "Yes" discards those edits. A local edit also bumps the in-memory version, so
version numbers cannot separate local edits from newer shared files. A GUI launch
with `-u` from the linked layout shows no `CoreUpdates` dialog.

The follow-up tests (`q9/`) settled the remaining layout questions: all user folders
(`UserChanges`, `ChangeSets`, `FileOuts`, `Logs`, `NewPackages`) sit under the launch
directory, recomputed at every start; `-u` installs only prefixed update files numbered above
the image's highest update; with same-name packages in several instances the filesystem's raw
directory order decides which loads; the walk costs about 3 ms per instance; a read-only
shared package makes `save` fail without touching the file.

With the whole `dist/` read-only (`q10/`), a GUI save of a shipped package opens a
`CannotDeleteFileException` debugger, saving a copy to the instance's `NewPackages` works, and
other instances load that copy only when they require its newer version. Code loaded with `-l`
has its errors swallowed, so failures there are silent.

## Sources

- Live image via the MCP bridge: `DirectoryEntry class>>cuisBaseDirectory`,
  `>>coreUpdatesDirectory`, `>>packagesDirectory`, `>>userBaseDirectory`,
  `>>projectBaseDirectory`, `>>releaseClassCachedState`; `ChangeSet class>>installNewUpdates`;
  `SystemDictionary>>processFinalCommandLineOption:optionArgument:raiseExceptions:`
- `~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/RunCuisOnMac.sh`
- `~/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/CoreUpdates/CoreUpdates.md`
- Live image via the MCP bridge: `ChangeSet class>>installNewUpdates:`
- `tmp-cuis-image-manager-research.md` (earlier observation of the dialog)
- User screenshot, session image 9
- `mcp-bridge/image/MCP-Bridge.pck.st:5-6` (`requires:` lines)
- Session probes `q4/probe.st`, `q4/bridge.st` and logs under the scratchpad path above
- Session probes under `.../scratchpad/q10/`: `R1-gui.st`, `R1b-gui.st`, `R2-saveas.st`, `R3-require.st`, `R4-require-1-30.st`, and their logs
- Session probes under `.../scratchpad/q9/`: `A.st`, `B.st`, `C.st`, `D-save.st`, `D-check.st`, `E.st`, `F-create-zeta.st`, `F-create-alpha.st`, `F-require.st`, `G.st`, and their logs
- Live image via the MCP bridge: `ChangeSet class>>newUpdates:do:`, `>>install:`, `SystemVersion>>updatesPrefix`, `SystemDictionary>>snapshot:andQuit:embedded:clearAllClassState:`, `Class>>fileOut`, `DirectoryEntry class>>fileOutsDirectory`, `>>fileOutsDirQuery:writeStreamDo:`
- Session probes `q8/watch.st`, `q8/watch2.st`, `q8/watch3.st` and logs under `.../scratchpad/q8/`
- Session probe `q6/save.st` and log under `.../scratchpad/q6/`
- Session probes `q7/t-load.st`, `q7/s-edit.st`, `q7/t-check.st`, `q7/r1-require.st`, `q7/r2-require-version.st`, `q7/r3-installPackage.st`, `q7/u1-installPackage.st`, `q7/u2-require-version.st`, `q7/u3-yes-branch.st` and logs under `.../scratchpad/q7/`
- Session probes `q5/install.st`, `q5/after-u.st`, `q5/a-create.st`, `q5/b-require.st` and logs under `.../scratchpad/q5/`
- Live image via the MCP bridge: `CodePackageFile class>>installPackage:`, `FeatureRequirement>>placesToLookForPackagesDo:`, `DirectoryEntry class>>newPackagesDirectory`, `CodePackage>>save`, `FeatureRequirement>>install`, `>>satisfyRequirementsAndInstall`, `Object>>confirm:`, `PopUpMenu class>>confirm:`
