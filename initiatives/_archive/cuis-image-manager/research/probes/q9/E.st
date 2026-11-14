Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ Feature require: 'JSON' ] on: ParserNotification do: [ :ex | ex resume: nil ].
Json compile: 'probeLocalOnly
	^ 1' classified: 'probe'.
Transcript show: 'PROBE unsaved=', (CodePackage installedPackages at: 'JSON') hasUnsavedChanges printString; newLine.
[ (Delay forSeconds: 8) wait.
  [ | found |
    found := false.
    UISupervisor ui allMorphsDo: [ :m |
		((m respondsTo: #contents) and: [ m contents isString and: [ m contents includesSubString: 'unsaved changes' ] ])
			ifTrue: [ found := true. Transcript show: 'PROBE confirm text: ', m contents printString; newLine ] ].
    Transcript show: 'PROBE confirmShown=', found printString, ' probeLocalOnly still present=', (Json includesSelector: #probeLocalOnly) printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE watcher error: ', ex class name, ' ', ex messageText printString; newLine ].
  Smalltalk quitPrimitive: 0 ] forkAt: Processor userInterruptPriority.
Transcript show: 'PROBE calling installPackage:'; newLine.
CodePackageFile installPackage: (CodePackage installedPackages at: 'JSON') fullFileName asFullFileEntry.
Transcript show: 'PROBE installPackage: returned'; newLine!
