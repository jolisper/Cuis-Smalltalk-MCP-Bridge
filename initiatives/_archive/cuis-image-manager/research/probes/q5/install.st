Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'PROBE cuisBase=', DirectoryEntry cuisBaseDirectory printString; newLine.
Transcript show: 'PROBE projectBase=', DirectoryEntry projectBaseDirectory printString; newLine.
(FeatureRequirement name: 'MCP-Bridge') placesToLookForPackagesDo: [ :d | Transcript show: 'PLACE ', d printString; newLine ].
[ [ ((FeatureRequirement name: 'MCP-Bridge') pathName: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/mcp-bridge/image/MCP-Bridge.pck.st') satisfyRequirementsAndInstall ]
	on: FeatureRequirementUnsatisfied do: [ :ex | Transcript show: 'PROBE unsatisfied: ', ex messageText printString; newLine ] ]
	on: ParserNotification do: [ :ex | ex resume: nil ].
CodePackage installedPackages do: [ :p | Transcript show: 'PROBE loaded ', p packageName, ' from ', p fullFileName printString; newLine ].
Transcript show: 'PROBE bridgeClass=', (Smalltalk includesKey: #McpBridgeServer) printString; newLine.
Smalltalk quitPrimitive: 0.
