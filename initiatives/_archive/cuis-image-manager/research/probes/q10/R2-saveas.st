Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ Feature require: 'JSON' ] on: ParserNotification do: [ :ex | ex resume: nil ].
Json compile: 'probeReadOnly
	^ 1' classified: 'probe'.
[ (CodePackage installedPackages at: 'JSON') save ] on: Error do: [ :ex | Transcript show: 'PROBE first save error: ', ex class name; newLine ].
[ | pkg |
  pkg := CodePackage installedPackages at: 'JSON'.
  pkg instVarNamed: 'fullFileName' put: (DirectoryEntry newPackagesDirectory // pkg packageFileName) pathName.
  pkg save.
  Transcript show: 'PROBE saved copy to ', pkg fullFileName, ' unsaved=', pkg hasUnsavedChanges printString, ' provides=', pkg provides printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE save-as error: ', ex class name, ' ', ex messageText printString; newLine ].
Smalltalk quitPrimitive: 0.
