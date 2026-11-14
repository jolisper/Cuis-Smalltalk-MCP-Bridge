Transcript logToStdout: true.
Transcript show: 'PROBE updatesPrefix=', SystemVersion current updatesPrefix printString, ' highestUpdate=', SystemVersion current highestUpdate printString; newLine.
Transcript show: 'PROBE ProbeUpdateOrder=', (Smalltalk at: #ProbeUpdateOrder ifAbsent: [ 'none' ]) printString; newLine.
Smalltalk quitPrimitive: 0.
