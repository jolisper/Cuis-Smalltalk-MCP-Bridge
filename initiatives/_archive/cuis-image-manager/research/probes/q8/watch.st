Transcript logToStdout: true.
[ (Delay forSeconds: 8) wait.
  Transcript show: 'PROBE dialogShown=', (UISupervisor ui allMorphs anySatisfy: [ :m |
		(m respondsTo: #contents) and: [ m contents isString and: [ m contents includesSubString: 'CoreUpdates' ] ] ]) printString; newLine.
  Transcript show: 'PROBE coreUpdatesExists=', DirectoryEntry coreUpdatesDirectory exists printString; newLine.
  Smalltalk quitPrimitive: 0 ] forkAt: Processor userInterruptPriority!
