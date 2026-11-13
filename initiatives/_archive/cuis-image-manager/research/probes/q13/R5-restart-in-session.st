Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
(Smalltalk at: #McpBridgeServer) stop; startOn: 17901.
(Delay forSeconds: 3) wait.
(Smalltalk at: #McpBridgeServer) stop; startOn: 17901.
Transcript show: 'RESTARTED'; newLine.
