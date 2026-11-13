Transcript logToStdout: true.
Transcript show: 'PROBE -l ran'; newLine.
[ (Delay forSeconds: 8) wait.
  Transcript show: 'PROBE watcher woke'; newLine.
  [ Transcript show: 'PROBE dialogShown=', (UISupervisor ui allMorphs anySatisfy: [ :m |
		(m respondsTo: #contents) and: [ m contents isString and: [ m contents includesSubString: 'CoreUpdates' ] ] ]) printString; newLine ]
	on: Error do: [ :ex | Transcript show: 'PROBE watcher error: ', ex class name, ' ', ex messageText printString; newLine ].
  Smalltalk quitPrimitive: 0 ] forkAt: Processor userInterruptPriority!
