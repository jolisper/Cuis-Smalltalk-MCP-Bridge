Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'PROBE pre packages=', CodePackage installedPackages keys printString; newLine.
Transcript show: 'PROBE pre bridgeClass=', (Smalltalk includesKey: #McpBridgeServer) printString; newLine.
[ CodePackageFile installPackage: (FileEntry withAbsolutePathName: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/mcp-bridge/image/MCP-Bridge.pck.st') ]
	on: ParserNotification do: [ :ex | Transcript show: 'PROBE parserNotification: ', ex messageText printString; newLine. ex resume: nil ].
Transcript show: 'PROBE post packages=', CodePackage installedPackages keys printString; newLine.
Transcript show: 'PROBE post bridgeClass=', (Smalltalk includesKey: #McpBridgeServer) printString; newLine.
Smalltalk quitPrimitive: 0.
