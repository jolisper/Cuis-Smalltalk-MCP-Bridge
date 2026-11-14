Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Smalltalk at: #ProbeSel put: ((Json selectors select: [ :s | s numArgs = 0 ]) asSortedCollection first).
Transcript show: 'PROBE editing existing method Json>>', (Smalltalk at: #ProbeSel); newLine.
Json compile: (Smalltalk at: #ProbeSel), '
	^ #localEdit' classified: 'probe-local'.
Json compile: 'probeLocalOnly
	^ 1' classified: 'probe-local'.
Transcript show: 'PROBE before reload: provides=', (CodePackage installedPackages at: 'JSON') provides printString, ' unsaved=', (CodePackage installedPackages at: 'JSON') hasUnsavedChanges printString; newLine.
[ [ Feature require: 'JSON' version: 1 revision: 30 ] on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied: ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
Transcript show: 'PROBE after reload: provides=', (CodePackage installedPackages at: 'JSON') provides printString, ' unsaved=', (CodePackage installedPackages at: 'JSON') hasUnsavedChanges printString; newLine.
Transcript show: 'PROBE probeSharedWrite (from file) present=', (Json includesSelector: #probeSharedWrite) printString; newLine.
Transcript show: 'PROBE probeLocalOnly (local, not in file) present=', (Json includesSelector: #probeLocalOnly) printString; newLine.
Transcript show: 'PROBE edited method still local=', ((Json sourceCodeAt: (Smalltalk at: #ProbeSel)) asString includesSubString: 'localEdit') printString; newLine.
Smalltalk quitPrimitive: 0.
