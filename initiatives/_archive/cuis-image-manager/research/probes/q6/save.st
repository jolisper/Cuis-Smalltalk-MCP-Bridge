Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ [ Feature require: 'JSON' ] on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied: ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
[ | pkg cls |
  pkg := CodePackage installedPackages at: 'JSON'.
  Transcript show: 'PROBE fullFileName=', pkg fullFileName printString; newLine.
  cls := Smalltalk allClasses detect: [ :c | c category notNil and: [ c category beginsWith: 'JSON' ] ].
  Transcript show: 'PROBE editing class=', cls name; newLine.
  cls compile: 'probeSharedWrite
	^ 7' classified: 'probe'.
  Transcript show: 'PROBE unsaved=', pkg hasUnsavedChanges printString; newLine.
  pkg save.
  Transcript show: 'PROBE saved to ', pkg fullFileName printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE error: ', ex class name, ' ', ex messageText printString; newLine ].
Smalltalk quitPrimitive: 0.
