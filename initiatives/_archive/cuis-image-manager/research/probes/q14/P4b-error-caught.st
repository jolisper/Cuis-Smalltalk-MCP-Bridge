Transcript logToStdout: true.
Transcript show: 'M1'; newLine.
[ nil foo ] on: Error do: [ :e | Transcript show: 'M1caught ', e messageText; newLine ].
Transcript show: 'M2'; newLine.
Smalltalk quitPrimitive: 0.
