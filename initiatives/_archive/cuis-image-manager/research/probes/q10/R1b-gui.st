Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ Feature require: 'JSON' ] on: ParserNotification do: [ :ex | ex resume: nil ].
Json compile: 'probeReadOnly
	^ 1' classified: 'probe'.
[ (Delay forSeconds: 8) wait.
  [ UISupervisor ui submorphs do: [ :m | (m respondsTo: #label) ifTrue: [ Transcript show: 'PROBE window: ', m label printString; newLine ] ].
    UISupervisor ui allMorphsDo: [ :m |
		((m respondsTo: #contents) and: [ m contents isString and: [ (m contents includesSubString: 'delete') or: [ (m contents includesSubString: 'Cannot') or: [ m contents includesSubString: 'JSON.pck' ] ] ] ])
			ifTrue: [ Transcript show: 'PROBE text: ', m contents printString; newLine ] ].
    Transcript show: 'PROBE unsaved=', (CodePackage installedPackages at: 'JSON') hasUnsavedChanges printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE watcher error: ', ex class name, ' ', ex messageText printString; newLine ].
  Smalltalk quitPrimitive: 0 ] forkAt: Processor userInterruptPriority.
Transcript show: 'PROBE calling save'; newLine.
UISupervisor whenUIinSafeState: [ Transcript show: 'PROBE UI save start'; newLine. (CodePackage installedPackages at: 'JSON') save. Transcript show: 'PROBE UI save returned'; newLine ].
Transcript show: 'PROBE save returned'; newLine!
