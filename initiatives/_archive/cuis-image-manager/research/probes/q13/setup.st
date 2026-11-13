Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
CodePackageFile installPackage: '/Users/jolisper/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/Packages/Features/JSON.pck.st' asFileEntry.
CodePackageFile installPackage: '/Users/jolisper/.cuis-mcp-bridge/cuis/7.8-d4f9cc1/dist/Packages/System/Network-Kernel.pck.st' asFileEntry.
CodePackageFile installPackage: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/mcp-bridge/image/MCP-Bridge.pck.st' asFileEntry.
(Smalltalk at: #McpBridgeServer) startOn: 17901.
Transcript show: 'SETUP bridge=', (Smalltalk includesKey: #McpBridgeServer) printString, ' trap=', (Smalltalk at: #SignalTrap) isArmed printString; newLine.
(Delay forSeconds: 1) wait.
Smalltalk saveAndQuit.
