Transcript logToStdout: true.
DirectoryEntry currentDirectory // 'cuis.ready' forceWriteStreamDo: [ :s | s nextPutAll: 'ready' ].
Transcript show: 'READY written'; newLine.
