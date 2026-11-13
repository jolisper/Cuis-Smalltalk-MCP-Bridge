Transcript logToStdout: true.
Utilities setAuthorName: 'Probe' initials: 'prb'.
[ Feature require: 'JSON' ] on: ParserNotification do: [ :ex | ex resume: nil ].
Transcript show: 'PROBE loaded provides=', (CodePackage installedPackages at: 'JSON') provides printString; newLine.
Transcript show: 'PROBE file provides=', (CodePackageFile providedFeatureInFile: (CodePackage installedPackages at: 'JSON') fullFileName asFullFileEntry) printString; newLine.
Json compile: 'probeSharedWrite
	^ 7' classified: 'probe'.
(CodePackage installedPackages at: 'JSON') save.
Transcript show: 'PROBE after save:'; newLine.
Transcript show: 'PROBE loaded provides=', (CodePackage installedPackages at: 'JSON') provides printString; newLine.
Transcript show: 'PROBE file provides=', (CodePackageFile providedFeatureInFile: (CodePackage installedPackages at: 'JSON') fullFileName asFullFileEntry) printString; newLine.
Smalltalk quitPrimitive: 0.
