Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
#( userBaseDirectory userChangesDirectory fileOutsDirectory logsDirectory savedChangeSetsDirectory newPackagesDirectory ) do: [ :s |
	Transcript show: 'PROBE ', s, '=', (DirectoryEntry perform: s) printString; newLine ].
Object subclass: #ProbeUserFiles instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'ProbeUserFiles'.
ProbeUserFiles compile: 'hello
	^ 1' classified: 'probe'.
[ ProbeUserFiles fileOut. Transcript show: 'PROBE fileOut done'; newLine ] on: Error do: [ :ex | Transcript show: 'PROBE fileOut error: ', ex messageText printString; newLine ].
Smalltalk quitPrimitive: 0.
