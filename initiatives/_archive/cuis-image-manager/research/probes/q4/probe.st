Transcript logToStdout: true.
Transcript show: 'PROBE cuisBase=', DirectoryEntry cuisBaseDirectory printString; newLine.
Transcript show: 'PROBE userBase=', DirectoryEntry userBaseDirectory printString; newLine.
Transcript show: 'PROBE coreUpdatesExists=', DirectoryEntry coreUpdatesDirectory exists printString; newLine.
Transcript show: 'PROBE packagesExists=', DirectoryEntry packagesDirectory exists printString; newLine.
Smalltalk quitPrimitive: 0.
