Utilities setAuthorName: 'Probe' initials: 'prb'.
| cls |
cls := Object subclass: #SignalTrapProbe instanceVariableNames: '' classVariableNames: 'Sema Handler StartUps Installed' poolDictionaries: '' category: 'Probe'.
cls class compile: 'forward: sigNum toSemaphoreIndex: idx
	<primitive: ''primitiveForwardSignalToSemaphore'' module: ''UnixOSProcessPlugin''>
	^ self primitiveFailed'.
cls class compile: 'install
	| idx |
	Handler ifNotNil: [ Handler terminate ].
	Sema := Semaphore new.
	idx := Smalltalk registerExternalObject: Sema.
	self perform: #forward:toSemaphoreIndex: with: 15 with: idx.
	Handler := [ Sema wait. Smalltalk saveAndQuit ] forkAt: Processor userBackgroundPriority.
	Installed := true'.
cls class compile: 'startUps
	^ StartUps'.
cls class compile: 'installed
	^ Installed'.
cls class compile: 'startUp: resuming
	StartUps := (StartUps ifNil: [ 0 ]) + 1.
	resuming ifTrue: [ self install ]'.
cls install.
