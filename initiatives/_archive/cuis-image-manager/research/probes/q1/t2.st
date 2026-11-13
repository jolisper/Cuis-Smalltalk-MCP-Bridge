Transcript logToStdout: true.
Transcript show: 'A'; newLine.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'B'; newLine.
Object subclass: #SignalTrapProbe instanceVariableNames: '' classVariableNames: 'Sema Handler StartUps Installed' poolDictionaries: '' category: 'Probe'.
Transcript show: 'C'; newLine.
SignalTrapProbe class compile: 'startUps
	^ StartUps'.
Transcript show: 'D'; newLine.
SignalTrapProbe class compile: 'forward: sigNum toSemaphoreIndex: idx
	<primitive: ''primitiveForwardSignalToSemaphore'' module: ''UnixOSProcessPlugin''>
	^ self primitiveFailed'.
Transcript show: 'E'; newLine.
Smalltalk quitPrimitive: 0.
