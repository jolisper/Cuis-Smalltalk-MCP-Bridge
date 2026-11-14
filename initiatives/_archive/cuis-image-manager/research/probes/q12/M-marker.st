Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Object subclass: #ProbePid instanceVariableNames: '' classVariableNames: '' poolDictionaries: '' category: 'Probe'.
ProbePid class compile: 'pid
	<primitive: ''primitiveGetPid'' module: ''UnixOSProcessPlugin''>
	^ nil'.
Transcript show: 'MARK armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' pid=', (Smalltalk at: #ProbePid) pid printString; newLine.
DirectoryEntry currentDirectory // 'cuis.ready' forceWriteStreamDo: [ :s | s nextPutAll: (Smalltalk at: #ProbePid) pid printString ].
Transcript show: 'MARK written'; newLine.
