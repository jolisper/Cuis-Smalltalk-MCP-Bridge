Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'ENSURE running=', (((Smalltalk at: #McpBridgeServer) instVarNamed: 'pollProcess') ifNil: [ false ] ifNotNil: [ :p | p isTerminated not ]) printString; newLine.
(((Smalltalk at: #McpBridgeServer) instVarNamed: 'pollProcess') ifNil: [ false ] ifNotNil: [ :p | p isTerminated not ]) ifFalse: [ (Smalltalk at: #McpBridgeServer) startOn: 17901 ].
