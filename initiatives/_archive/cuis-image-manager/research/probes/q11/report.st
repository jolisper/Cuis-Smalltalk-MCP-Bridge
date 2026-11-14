Smalltalk garbageCollect.
Transcript show: 'REPORT armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' live=', (Process allInstances reject: [ :p | p isTerminated ]) size printString, ' semWaiters=', (Process allInstances select: [ :p | p isTerminated not and: [ p suspendingList isKindOf: Semaphore ] ]) size printString; newLine.
