Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ Feature require: 'JSON' ] on: ParserNotification do: [ :ex | ex resume: nil ].
Transcript show: 'PROBE loaded from ', (CodePackage installedPackages at: 'JSON') fullFileName printString; newLine.
Json compile: 'probeReadOnly
	^ 1' classified: 'probe'.
[ (CodePackage installedPackages at: 'JSON') save. Transcript show: 'PROBE save returned normally'; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE save error: ', ex class name, ' ', ex messageText printString; newLine ].
Transcript show: 'PROBE unsaved after save=', (CodePackage installedPackages at: 'JSON') hasUnsavedChanges printString, ' provides=', (CodePackage installedPackages at: 'JSON') provides printString; newLine.
Smalltalk quitPrimitive: 0.
