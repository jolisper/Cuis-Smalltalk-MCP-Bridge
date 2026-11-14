'From Cuis7.8 [latest update: #7959] on 10 November 2026 at 12:00:00 pm'!
'Description Save the image and quit when the VM receives SIGTERM. Re-arms itself at every start.'!
!provides: 'SignalTrap' 1 0!
!requires: 'Cuis-Base' 60 5557 nil!
SystemOrganization addCategory: #SignalTrap!


!classDefinition: #SignalTrap category: #SignalTrap!
Object subclass: #SignalTrap
	instanceVariableNames: ''
	classVariableNames: 'Armed Handler Sema'
	poolDictionaries: ''
	category: 'SignalTrap'!
!classDefinition: 'SignalTrap class' category: #SignalTrap!
SignalTrap class
	instanceVariableNames: ''!


!SignalTrap commentStamp: 'prb 11/10/2026 12:00:00' prior: 0!
I save the image and quit when the VM receives SIGTERM (15). The VM forgets signal handlers and external semaphores across a save, so I re-arm at every real start-up through the start-up list. If the VM has no UnixOSProcessPlugin I stay disarmed and SIGTERM keeps its default effect.!

!SignalTrap class methodsFor: 'private' stamp: 'prb 11/10/2026 12:00:00'!
forward: sigNum toSemaphoreIndex: idx
	<primitive: 'primitiveForwardSignalToSemaphore' module: 'UnixOSProcessPlugin'>
	^ nil! !

!SignalTrap class methodsFor: 'arming' stamp: 'prb 11/10/2026 12:00:00'!
install
	| idx |
	Handler ifNotNil: [ Handler terminate. Handler := nil ].
	self forward: 15 toSemaphoreIndex: 0.
	Sema ifNotNil: [ Smalltalk unregisterExternalObject: Sema ].
	Sema := Semaphore new.
	idx := Smalltalk registerExternalObject: Sema.
	Armed := (self forward: 15 toSemaphoreIndex: idx) notNil.
	Armed ifFalse: [ Smalltalk unregisterExternalObject: Sema. ^ self ].
	"forkAt: answers nil in Cuis, so build the Process with newProcess to keep a reference."
	Handler := [ Sema wait. Smalltalk saveAndQuit ] newProcess.
	Handler priority: Processor lowIOPriority.
	Handler resume! !

!SignalTrap class methodsFor: 'arming' stamp: 'prb 11/10/2026 12:00:00'!
uninstall
	Smalltalk removeFromStartUpList: self.
	Handler ifNotNil: [ Handler terminate. Handler := nil ].
	self forward: 15 toSemaphoreIndex: 0.
	Sema ifNotNil: [ Smalltalk unregisterExternalObject: Sema ].
	Armed := false! !

!SignalTrap class methodsFor: 'accessing' stamp: 'prb 11/10/2026 12:00:00'!
isArmed
	^ Armed == true and: [ Handler notNil and: [ Handler isTerminated not ] ]! !

!SignalTrap class methodsFor: 'system startup' stamp: 'prb 11/10/2026 12:00:00'!
startUp: isARealStartup
	isARealStartup ifTrue: [ self install ]! !

!SignalTrap class methodsFor: 'class initialization' stamp: 'prb 11/10/2026 12:00:00'!
initialize
	Smalltalk addToStartUpList: self.
	self install! !

SignalTrap initialize!
