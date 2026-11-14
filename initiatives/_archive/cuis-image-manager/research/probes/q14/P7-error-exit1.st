Transcript logToStdout: true.
Transcript show: 'M1'; newLine.
[ nil foo ] on: Error do: [ :e | Transcript show: 'M1failed ', e messageText; newLine. Smalltalk quitPrimitive: 1 ].
