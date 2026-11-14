Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
CodePackageFile installPackage: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/initiatives/cuis-image-manager/research/probes/q11/SignalTrap.pck.st' asFileEntry.
Transcript show: 'LOADED armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' startUp=', ((SystemDictionary classPool at: #StartUpList) includes: #SignalTrap) printString; newLine.
(Smalltalk at: #SignalTrap) class compile: 'install
	| idx |
	Sema := Semaphore new.
	idx := Smalltalk registerExternalObject: Sema.
	Armed := (self forward: 15 toSemaphoreIndex: idx) notNil.
	Handler := [ Sema wait. Smalltalk saveAndQuit ] newProcess.
	Handler priority: Processor userBackgroundPriority.
	Handler resume'.
Smalltalk garbageCollect.
Transcript show: 'REPORT armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' live=', (Process allInstances reject: [ :p | p isTerminated ]) size printString, ' semWaiters=', (Process allInstances select: [ :p | p isTerminated not and: [ p suspendingList isKindOf: Semaphore ] ]) size printString; newLine.
Smalltalk saveAndQuit.
