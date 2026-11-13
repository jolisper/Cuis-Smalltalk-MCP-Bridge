Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Object subclass: #SignalTrapProbe instanceVariableNames: '' classVariableNames: 'Sema Handler StartUps Installed' poolDictionaries: '' category: 'Probe'.
Transcript show: 'S1 class'; newLine.
SignalTrapProbe class compile: 'forward: sigNum toSemaphoreIndex: idx
	<primitive: ''primitiveForwardSignalToSemaphore'' module: ''UnixOSProcessPlugin''>
	^ self primitiveFailed'.
SignalTrapProbe class compile: 'install
	| idx |
	Handler ifNotNil: [ Handler terminate ].
	Sema := Semaphore new.
	idx := Smalltalk registerExternalObject: Sema.
	self perform: #forward:toSemaphoreIndex: with: 15 with: idx.
	Handler := [ Sema wait. Smalltalk saveAndQuit ] forkAt: Processor userBackgroundPriority.
	Installed := true'.
Transcript show: 'S2 install'; newLine.
SignalTrapProbe class compile: 'startUps
	^ StartUps'.
SignalTrapProbe class compile: 'installed
	^ Installed'.
SignalTrapProbe class compile: 'startUp: resuming
	StartUps := (StartUps ifNil: [ 0 ]) + 1.
	resuming ifTrue: [ self install ]'.
Transcript show: 'S3 hooks'; newLine.
SignalTrapProbe perform: #install.
Transcript show: 'S4 installed'; newLine.
