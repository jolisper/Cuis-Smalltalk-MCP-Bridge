Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
(FeatureRequirement name: 'ProbeDup') placesToLookForPackagesDo: [ :d | ((d pathName includesSubString: 'NewPackages') or: [ d pathName endsWith: 'instances' ]) ifTrue: [ Transcript show: 'PLACE ', d pathName; newLine ] ].
[ [ Feature require: 'ProbeDup' ] on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
Transcript show: 'PROBE loaded from ', (CodePackage installedPackages at: 'ProbeDup') fullFileName printString, ' origin=', (Smalltalk at: #ProbeDupThing) origin printString; newLine.
Smalltalk quitPrimitive: 0.
