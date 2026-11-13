Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
CodePackageFile installPackage: '/Users/jolisper/Source/Cuis-Smalltalk-MCP-Bridge/initiatives/cuis-image-manager/research/probes/q11/SignalTrap.pck.st' asFileEntry.
Transcript show: 'LOADED armed=', (Smalltalk at: #SignalTrap) isArmed printString, ' startUp=', ((SystemDictionary classPool at: #StartUpList) includes: #SignalTrap) printString; newLine.
[ Transcript show: 'D1 ', ((Smalltalk at: #SignalTrap) classPool at: #Armed) printString; newLine ] on: Error do: [ :e | Transcript show: 'E1 ', e class name, ' ', e messageText printString; newLine ].
[ Transcript show: 'D2 ', ((Smalltalk at: #SignalTrap) classPool at: #Handler) printString; newLine ] on: Error do: [ :e | Transcript show: 'E2 ', e class name, ' ', e messageText printString; newLine ].
[ Transcript show: 'D3 ', ((Smalltalk at: #SignalTrap) classPool at: #Handler) isTerminated printString; newLine ] on: Error do: [ :e | Transcript show: 'E3 ', e class name, ' ', e messageText printString; newLine ].
[ Transcript show: 'D4 ', ((Smalltalk at: #SignalTrap) classPool at: #Sema) printString; newLine ] on: Error do: [ :e | Transcript show: 'E4 ', e class name, ' ', e messageText printString; newLine ].
[ Transcript show: 'D5 ', ((Smalltalk at: #SignalTrap) forward: 15 toSemaphoreIndex: 0) printString; newLine ] on: Error do: [ :e | Transcript show: 'E5 ', e class name, ' ', e messageText printString; newLine ].
Smalltalk quitPrimitive: 3.
