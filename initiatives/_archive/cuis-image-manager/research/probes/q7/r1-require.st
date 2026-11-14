Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'PROBE before: provides=', (CodePackage installedPackages at: 'JSON') provides printString, ' hasProbeMethod=', (Json includesSelector: #probeSharedWrite) printString; newLine.
[ [ Feature require: 'JSON' ] on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied: ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
Transcript show: 'PROBE after: provides=', (CodePackage installedPackages at: 'JSON') provides printString, ' hasProbeMethod=', (Json includesSelector: #probeSharedWrite) printString; newLine.
Smalltalk quitPrimitive: 0.
