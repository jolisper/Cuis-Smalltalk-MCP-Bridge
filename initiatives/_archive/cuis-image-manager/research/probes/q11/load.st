Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
CodePackageFile installPackage: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/initiatives/cuis-image-manager/research/probes/q11/SignalTrap.pck.st' asFileEntry.
Transcript show: 'LOADED armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' startUp=', ((SystemDictionary classPool at: #StartUpList) includes: #SignalTrap) printString; newLine.
