Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
SignalTrap class compile: 'install
	| idx |
	Handler ifNotNil: [ Handler terminate. Handler := nil ].
	self forward: 15 toSemaphoreIndex: 0.
	Sema ifNotNil: [ Smalltalk unregisterExternalObject: Sema ].
	Sema := Semaphore new.
	idx := Smalltalk registerExternalObject: Sema.
	Armed := (self forward: 15 toSemaphoreIndex: idx) notNil.
	Armed ifFalse: [ Smalltalk unregisterExternalObject: Sema. ^ self ].
	Handler := [ Sema wait. Smalltalk saveAndQuit ] newProcess.
	Handler priority: Processor lowIOPriority.
	Handler resume'.
SignalTrap install.
Transcript show: 'H60 armed=', SignalTrap isArmed printString, ' prio=', ((SignalTrap classPool at: #Handler) priority) printString; newLine.
Smalltalk saveAndQuit.
