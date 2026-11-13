Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Object subclass: #ProbeDupThing instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'ProbeDup'.
ProbeDupThing class compile: 'origin
	^ ''zeta'''.
[ | pkg |
  pkg := CodePackage named: 'ProbeDup' createIfAbsent: true registerIfNew: true.
  pkg instVarNamed: 'fullFileName' put: (DirectoryEntry newPackagesDirectory // pkg packageFileName) pathName.
  pkg save.
  Transcript show: 'PROBE saved to ', pkg fullFileName; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE error: ', ex messageText printString; newLine ].
Smalltalk quitPrimitive: 0.
