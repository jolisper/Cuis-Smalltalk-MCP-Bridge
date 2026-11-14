Transcript logToStdout: true.
Transcript show: 'PROBE -l ran'; newLine.
[ (Delay forSeconds: 8) wait.
  [ | found |
    found := false.
    UISupervisor ui allMorphsDo: [ :m |
		((m respondsTo: #contents) and: [ m contents isString and: [ m contents includesSubString: 'CoreUpdates' ] ])
			ifTrue: [ found := true. Transcript show: 'PROBE dialog text: ', m contents printString; newLine ] ].
    Transcript show: 'PROBE dialogShown=', found printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE watcher error: ', ex class name, ' ', ex messageText printString; newLine ].
  Smalltalk quitPrimitive: 0 ] forkAt: Processor userInterruptPriority!
