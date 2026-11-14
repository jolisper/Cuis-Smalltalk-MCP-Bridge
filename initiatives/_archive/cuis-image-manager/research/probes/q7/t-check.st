Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
Transcript show: 'PROBE T after -u, hasProbeMethod=', (Json includesSelector: #probeSharedWrite) printString; newLine.
Transcript show: 'PROBE loaded provides=', (CodePackage installedPackages at: 'JSON') provides printString; newLine.
Transcript show: 'PROBE file provides=', (CodePackageFile providedFeatureInFile: (CodePackage installedPackages at: 'JSON') fullFileName asFullFileEntry) printString; newLine.
Smalltalk quitPrimitive: 0.
