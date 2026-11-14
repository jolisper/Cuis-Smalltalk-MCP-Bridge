Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'PROBE projectBase=', DirectoryEntry projectBaseDirectory printString; newLine.
[ [ Feature require: 'ProbeShared' ]
	on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied: ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
CodePackage installedPackages do: [ :p | Transcript show: 'PROBE loaded ', p packageName, ' from ', p fullFileName printString; newLine ].
Transcript show: 'PROBE answer=', ((Smalltalk at: #ProbeSharedThing ifAbsent: [ nil ]) ifNotNil: [ :c | c answer printString ] ifNil: [ 'class absent' ]); newLine.
Smalltalk quitPrimitive: 0.
