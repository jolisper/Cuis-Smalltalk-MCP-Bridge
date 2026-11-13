Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Object subclass: #ProbeSharedThing instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'ProbeShared'.
ProbeSharedThing class compile: 'answer
	^ 42'.
[ | pkg |
  pkg := CodePackage named: 'ProbeShared' createIfAbsent: true registerIfNew: true.
  pkg instVarNamed: 'fullFileName' put: (DirectoryEntry newPackagesDirectory // pkg packageFileName) pathName.
  pkg save.
  Transcript show: 'PROBE saved to ', pkg fullFileName; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE error: ', ex class name, ' ', ex messageText printString; newLine ].
Smalltalk quitPrimitive: 0.
