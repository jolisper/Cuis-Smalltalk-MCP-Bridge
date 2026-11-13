Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ [ Feature require: 'JSON' ] on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
(CodePackage installedPackages at: 'JSON' ifAbsent: [ nil ]) ifNotNil: [ :p |
	Transcript show: 'PROBE loaded from ', p fullFileName printString, ' provides=', p provides printString, ' hasProbeMethod=', (Json includesSelector: #probeReadOnly) printString; newLine ].
Smalltalk quitPrimitive: 0.
